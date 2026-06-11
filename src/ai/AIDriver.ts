import * as THREE from 'three';
import type { ITrackQuery } from '../types/track';
import type { KartState, KartInput } from '../types/kart';
import { ItemType, type ProjectileState } from '../types/items';
import type { RaceState } from '../types/race';
import { TUNING } from '../config/tuning';
import { angleDiff, clamp, mod, randRange } from '../core/MathUtils';
import { AIItemUser } from './AIItemUser';
import {
  createCurvatureSample,
  measureCurvature,
  offsetLimit,
  pickLateralOffset,
  type CurvatureSample,
} from './RacingLine';

/**
 * AI module facade. Computes one KartInput per kart every fixed step and
 * exposes the rubber-banding speed multipliers consumed by the physics.
 *
 * Internal collaborators: RacingLine (curvature / offset utilities) and
 * AIItemUser (item button decisions). Nothing else should import them.
 */

/** Curvature above which the AI slows down (rad over the next 30 m). */
const SLOW_TURN_THRESHOLD = 0.5;
/** Speed above which a SLOW_TURN corner triggers a lifted throttle. */
const SLOW_TURN_SPEED = 22;
/** Harder corner: brake briefly above this speed. */
const BRAKE_TURN_THRESHOLD = 0.9;
const BRAKE_TURN_SPEED = 26;

/** Drift engage/release thresholds on the signed upcoming turn (hysteresis). */
const DRIFT_ENGAGE_TURN = 0.6;
const DRIFT_RELEASE_TURN = 0.25;
/** Max curvature on the "wrong" side for the turn to count as one-sided. */
const DRIFT_SIDE_TOLERANCE = 0.25;

/** Projectile avoidance: lateral clearance and resulting dodge offset. */
const AVOID_LATERAL_RANGE = 2.5;
const AVOID_DODGE_OFFSET = 2.8;
/** Curvilinear window ahead in which hazards are scanned: [3, lookahead+10]. */
const AVOID_MIN_AHEAD = 3;
const AVOID_EXTRA_AHEAD = 10;

/** Low-frequency steering noise amplitude (humanizes trajectories). */
const STEER_NOISE_AMPLITUDE = 0.05;

/** Per-kart mutable driving state. */
interface DriverState {
  /** Current desired lateral offset from the centerline (meters). */
  offset: number;
  /** Seconds until the offset is re-rolled. */
  offsetTimer: number;
  /** True while the AI intends to hold the drift button. */
  drifting: boolean;
  /** Per-AI skill in [0.85, 1]: caps throttle and scales steer precision. */
  skill: number;
  /** Steering noise oscillator parameters (unique per AI). */
  noisePhase: number;
  noiseFreq: number;
}

const NEUTRAL: Readonly<KartInput> = { throttle: 0, steer: 0, drift: false, useItem: false };

// Module-level scratch vectors: zero allocation per tick.
const scratchTargetPos = new THREE.Vector3();
const scratchTargetRight = new THREE.Vector3();
const scratchDelta = new THREE.Vector3();

export class AIDriver {
  /**
   * Rubber-banding multiplier per kart (1 for the player), recomputed by every
   * computeInputs call. Applied to maxSpeed/accel by the integration layer.
   */
  readonly speedMultipliers: number[] = [];

  private readonly track: ITrackQuery;
  private readonly itemUser = new AIItemUser();
  private readonly states: DriverState[] = [];
  /** Reused output array (one KartInput object per kart, mutated in place). */
  private readonly inputs: KartInput[] = [];
  private readonly curvature: CurvatureSample = createCurvatureSample();
  /** Internal clock for the steering noise oscillators. */
  private time = 0;

  constructor(track: ITrackQuery) {
    this.track = track;
  }

  /** Resets all per-kart internal state (new race / restart). */
  reset(): void {
    this.time = 0;
    for (const s of this.states) {
      s.offset = 0;
      s.offsetTimer = 0;
      s.drifting = false;
      // skill / noise parameters are personality traits: kept across resets.
    }
    this.itemUser.reset();
  }

  /**
   * Computes one input per kart, aligned on `karts`. The returned array and
   * its objects are reused between calls (copy if you need to keep them).
   */
  computeInputs(
    karts: KartState[],
    projectiles: ProjectileState[],
    race: RaceState,
    dt: number,
  ): KartInput[] {
    this.ensureSize(karts.length);
    this.time += dt;
    this.updateSpeedMultipliers(karts);

    const driving = race.phase === 'RACING' || race.phase === 'FINISHED';

    for (let i = 0; i < karts.length; i++) {
      const kart = karts[i];
      const input = this.inputs[i];
      input.throttle = NEUTRAL.throttle;
      input.steer = NEUTRAL.steer;
      input.drift = NEUTRAL.drift;
      input.useItem = NEUTRAL.useItem;

      // Player input comes from the keyboard; AI idles before the green light.
      if (kart.isPlayer || !driving) continue;

      this.drive(kart, i, karts, projectiles, input, dt);
    }
    return this.inputs;
  }

  // ------------------------------------------------------------------ //

  private ensureSize(count: number): void {
    while (this.states.length < count) {
      const i = this.states.length;
      this.states.push({
        offset: 0,
        offsetTimer: 0,
        drifting: false,
        skill: randRange(0.85, 1),
        noisePhase: i * 1.7 + randRange(0, Math.PI * 2),
        noiseFreq: randRange(0.5, 0.9),
      });
      this.inputs.push({ throttle: 0, steer: 0, drift: false, useItem: false });
      this.speedMultipliers.push(1);
    }
    this.itemUser.ensureSize(count);
  }

  /** mult = clamp(1 + (playerProgress - progress) / L * gain, min, max). */
  private updateSpeedMultipliers(karts: KartState[]): void {
    let playerProgress = 0;
    for (let i = 0; i < karts.length; i++) {
      if (karts[i].isPlayer) {
        playerProgress = karts[i].progress;
        break;
      }
    }
    const { rubberBandGain, rubberBandMin, rubberBandMax } = TUNING.ai;
    const invLength = 1 / this.track.totalLength;
    for (let i = 0; i < karts.length; i++) {
      const kart = karts[i];
      this.speedMultipliers[i] = kart.isPlayer
        ? 1
        : clamp(
            1 + (playerProgress - kart.progress) * invLength * rubberBandGain,
            rubberBandMin,
            rubberBandMax,
          );
    }
  }

  private drive(
    kart: KartState,
    index: number,
    karts: KartState[],
    projectiles: ProjectileState[],
    input: KartInput,
    dt: number,
  ): void {
    const state = this.states[index];
    const ai = TUNING.ai;

    // (a) Lateral offset: re-rolled every few seconds, biased toward the
    // inside of the next corner (see RacingLine.pickLateralOffset).
    state.offsetTimer -= dt;
    if (state.offsetTimer <= 0) {
      state.offset = pickLateralOffset(this.track, kart.splineHint);
      state.offsetTimer = randRange(ai.offsetChangeMin, ai.offsetChangeMax);
    }

    // Look-ahead target point on the spline.
    const lookahead = ai.lookaheadBase + kart.speed * ai.lookaheadSpeedFactor;
    const targetDistance = kart.splineHint + lookahead;
    const sample = this.track.sampleAtDistance(targetDistance);
    // Copy the frame before any further sampling (samples may share storage).
    scratchTargetPos.copy(sample.position);
    scratchTargetRight.copy(sample.right);
    const limit = offsetLimit(sample.roadHalfWidth);

    let offset = clamp(state.offset, -limit, limit);

    // (b) Hazard avoidance: dodge static bananas and shells sitting on the
    // upcoming stretch of road.
    offset = this.avoidProjectiles(kart, projectiles, offset, limit, lookahead);

    // (c) Steering toward the offset target point.
    scratchTargetPos.addScaledVector(scratchTargetRight, offset);
    const desiredHeading = Math.atan2(
      scratchTargetPos.x - kart.position.x,
      scratchTargetPos.z - kart.position.z,
    );
    const headingError = angleDiff(desiredHeading, kart.heading);
    // (f) Skill scales precision; a slow sine adds organic wobble.
    const noise =
      Math.sin(this.time * state.noiseFreq + state.noisePhase) * STEER_NOISE_AMPLITUDE;
    let steer = clamp(headingError * ai.steerGain * state.skill + noise, -1, 1);

    // (d) Throttle from the upcoming curvature.
    const curv = measureCurvature(this.track, kart.splineHint, this.curvature);
    let throttle = state.skill; // skill caps top throttle
    if (curv.totalTurn > BRAKE_TURN_THRESHOLD && kart.speed > BRAKE_TURN_SPEED) {
      throttle = -0.3; // brief brake into a hard corner
    } else if (curv.totalTurn > SLOW_TURN_THRESHOLD && kart.speed > SLOW_TURN_SPEED) {
      throttle = 0.3;
    }

    // (e) Drift on sustained one-sided corners, with hysteresis so the AI
    // holds through the corner and releases on the straight (mini-turbo).
    steer = this.updateDrift(kart, state, curv, steer, input);

    if (kart.spinTimer > 0) {
      // No control while spinning: keep a sane input, never drift.
      input.drift = false;
      state.drifting = false;
      throttle = 0.5;
    }

    if (kart.finished) {
      // Victory lap: cruise gently along the line, no items, no drift.
      input.throttle = 0.5;
      input.steer = steer;
      input.drift = false;
      input.useItem = false;
      state.drifting = false;
      return;
    }

    input.throttle = throttle;
    input.steer = steer;
    input.useItem =
      kart.heldItem !== null || this.hasPendingItemPress(kart)
        ? this.itemUser.update(kart, index, karts, curv.totalTurn, dt)
        : this.itemUser.update(kart, index, karts, curv.totalTurn, dt);
  }

  /** The item user also tracks timers when no item is held. */
  private hasPendingItemPress(_kart: KartState): boolean {
    return true;
  }

  /**
   * Scans hazards within [3, lookahead+10] m ahead (curvilinear, wrap-around)
   * and shifts the aimed offset away from any that blocks the trajectory.
   */
  private avoidProjectiles(
    kart: KartState,
    projectiles: ProjectileState[],
    offset: number,
    limit: number,
    lookahead: number,
  ): number {
    const total = this.track.totalLength;
    const maxAhead = lookahead + AVOID_EXTRA_AHEAD;

    for (let i = 0; i < projectiles.length; i++) {
      const proj = projectiles[i];
      if (!proj.alive) continue;
      // Only static bananas and shells are dodged (a flying banana is brief).
      if (proj.type === ItemType.BANANA && !proj.isStatic) continue;
      // Ignore our own projectile right after launch.
      if (proj.ownerId === kart.id && proj.ownerImmunity > 0) continue;

      const ahead = mod(proj.splineHint - kart.splineHint, total);
      if (ahead < AVOID_MIN_AHEAD || ahead > maxAhead) continue;

      // Lateral position of the hazard in the road frame.
      const s = this.track.sampleAtDistance(proj.splineHint);
      const lateral = scratchDelta.copy(proj.position).sub(s.position).dot(s.right);

      if (Math.abs(lateral - offset) < AVOID_LATERAL_RANGE) {
        // Dodge to the opposite side of the hazard, clamped to the road.
        const side = offset <= lateral ? -1 : 1;
        offset = clamp(lateral + side * AVOID_DODGE_OFFSET, -limit, limit);
      }
    }
    return offset;
  }

  /**
   * Drift state machine. Returns the (possibly strengthened) steer value:
   * triggering the hop requires |steer| >= TUNING.drift.minSteer on the
   * correct side, so the steer is floored while the hop has not engaged yet.
   */
  private updateDrift(
    kart: KartState,
    state: DriverState,
    curv: CurvatureSample,
    steer: number,
    input: KartInput,
  ): number {
    const absTurn = Math.abs(curv.signedTurn);
    const oneSided = curv.totalTurn - absTurn < DRIFT_SIDE_TOLERANCE;

    if (!state.drifting) {
      if (
        absTurn > DRIFT_ENGAGE_TURN &&
        oneSided &&
        kart.speed > TUNING.drift.minSpeed * 1.2 &&
        kart.spinTimer <= 0
      ) {
        state.drifting = true;
      }
    } else if (
      absTurn < DRIFT_RELEASE_TURN || // road straightens: release, collect turbo
      kart.speed < TUNING.drift.minSpeed ||
      kart.spinTimer > 0
    ) {
      state.drifting = false;
    }

    input.drift = state.drifting;
    if (state.drifting && !kart.drift.active) {
      // Make sure the hop triggers: commit the steer toward the corner.
      const dir = curv.signedTurn >= 0 ? 1 : -1;
      if (steer * dir < TUNING.drift.minSteer) {
        steer = dir * Math.max(TUNING.drift.minSteer * 1.5, Math.abs(steer));
      }
    }
    return steer;
  }
}
