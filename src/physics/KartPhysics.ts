import * as THREE from 'three';
import type { KartState, KartInput } from '../types/kart';
import type { ITrackQuery } from '../types/track';
import { EventBus } from '../core/EventBus';
import { TUNING } from '../config/tuning';
import { clamp, damp } from '../core/MathUtils';
import { DriftController } from './DriftController';

// --- Feel constants derived from the spec (not gameplay balance knobs) ---
/** Soft clamp rate when above the effective max speed (boost end is gradual). */
const OVERSPEED_DAMP_LAMBDA = 2;
/** Damping rate of the purely visual slip angle. */
const VISUAL_SLIP_LAMBDA = 8;
/** Maximum visual slip angle (radians) while drifting. */
const VISUAL_SLIP_MAX = 0.45;
/** Turn-rate falloff per m/s above turnSpeedPeak (bell curve right side). */
const HIGH_SPEED_TURN_FALLOFF = 0.04;
/** Fraction of turnRate available while throttling at (near) standstill. */
const LOW_SPEED_TURN_FLOOR = 0.45;

// Scratch vectors (single-threaded fixed-step simulation, no allocation per tick).
const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();

/**
 * Arcade kart physics: fixed-step longitudinal/lateral dynamics on the XZ
 * plane, with the track providing ground height, surfaces and walls.
 * Y is up; forward of heading h is (sin h, 0, cos h), local right is
 * (cos h, 0, -sin h). The track frame (cp.forward / cp.right) is only used
 * for wall response.
 */
export class KartPhysics {
  private readonly drift: DriftController;

  constructor(
    private readonly track: ITrackQuery,
    bus: EventBus,
  ) {
    this.drift = new DriftController(bus);
  }

  /**
   * Steps every kart by one fixed tick. inputs[i] drives karts[i];
   * speedMults[i] (default 1) is the AI rubber-banding multiplier applied to
   * both max speed and acceleration.
   */
  stepAll(karts: KartState[], inputs: KartInput[], dt: number, speedMults?: number[]): void {
    for (let i = 0; i < karts.length; i++) {
      this.stepKart(karts[i], inputs[i], dt, speedMults?.[i] ?? 1);
    }
  }

  private stepKart(kart: KartState, input: KartInput, dt: number, speedMult: number): void {
    // (a) Snapshot for render interpolation.
    kart.prevPosition.copy(kart.position);
    kart.prevHeading = kart.heading;

    // (b) Timers.
    kart.boostTimer = Math.max(0, kart.boostTimer - dt);
    kart.spinTimer = Math.max(0, kart.spinTimer - dt);
    kart.starTimer = Math.max(0, kart.starTimer - dt);
    kart.drift.hopTimer = Math.max(0, kart.drift.hopTimer - dt);

    // (c) While spinning out, inputs are ignored and the drift is released.
    const spinning = kart.spinTimer > 0;
    const throttle = spinning ? 0 : clamp(input.throttle, -1, 1);
    const steer = spinning ? 0 : clamp(input.steer, -1, 1);
    const driftHeld = spinning ? false : input.drift;

    // (d) Decompose velocity in the kart's local frame.
    FORWARD.set(Math.sin(kart.heading), 0, Math.cos(kart.heading));
    RIGHT.set(Math.cos(kart.heading), 0, -Math.sin(kart.heading));
    let vForward = kart.velocity.dot(FORWARD);
    let vLateral = kart.velocity.dot(RIGHT);

    // (e) Effective max speed. Offroad penalty is bypassed by boost or star.
    const boosted = kart.boostTimer > 0;
    const starred = kart.starTimer > 0;
    const surfaceMult =
      kart.surface === 'OFFROAD' && !boosted && !starred ? TUNING.kart.offroadSpeedMult : 1;
    const maxSpeedEff =
      TUNING.kart.maxSpeed *
      surfaceMult *
      (1 + kart.coins * TUNING.kart.coinSpeedBonus) *
      (boosted ? TUNING.boost.speedMult : 1) *
      (starred ? TUNING.star.speedMult : 1) *
      speedMult;

    // (f) Longitudinal dynamics.
    if (spinning) {
      // Strong deceleration toward rest, no control.
      const dec = TUNING.hit.spinDecel * dt;
      vForward = vForward > 0 ? Math.max(0, vForward - dec) : Math.min(0, vForward + dec);
    } else if (throttle > 0) {
      const accelMult = boosted ? TUNING.boost.accelMult : 1;
      vForward += throttle * TUNING.kart.accel * accelMult * speedMult * dt;
    } else if (throttle < 0) {
      if (vForward > 0) {
        // Brake first (does not cross zero within a tick)...
        vForward = Math.max(0, vForward + throttle * TUNING.kart.brakeDecel * dt);
      } else {
        // ...then accelerate in reverse up to maxReverseSpeed.
        vForward = Math.max(
          -TUNING.kart.maxReverseSpeed,
          vForward + throttle * TUNING.kart.accel * speedMult * dt,
        );
      }
    }

    // Quadratic drag + rolling resistance; never flips the sign of vForward
    // on its own (a parked kart stays parked).
    if (vForward !== 0) {
      const dragDecel =
        TUNING.kart.dragCoeff * vForward * Math.abs(vForward) +
        TUNING.kart.rollingResistance * Math.sign(vForward);
      const vAfter = vForward - dragDecel * dt;
      vForward = vForward > 0 ? Math.max(0, vAfter) : Math.min(0, vAfter);
    }

    // Above the cap (boost just ended, entered offroad...), ease back down
    // instead of clamping hard.
    if (vForward > maxSpeedEff) {
      vForward = damp(vForward, maxSpeedEff, OVERSPEED_DAMP_LAMBDA, dt);
    }

    // (g) Lateral friction: low grip while drifting lets the kart slide.
    const grip = kart.drift.active ? TUNING.kart.gripDrift : TUNING.kart.gripNormal;
    vLateral *= Math.exp(-grip * dt);

    // (h)/(i) Heading: the drift controller owns it while a drift is active,
    // otherwise a bell-curve steering response (peak agility around
    // turnSpeedPeak, gentle falloff at high speed). While throttling from a
    // (near) standstill the kart can still pivot — otherwise a kart pinned
    // nose-first against a wall could never recover (turn rate would be 0).
    const drifting = this.drift.update(kart, driftHeld, steer, vForward, dt);
    if (!drifting) {
      const v = Math.abs(vForward);
      const peak = TUNING.kart.turnSpeedPeak;
      let speedFactor = v < peak ? v / peak : 1 / (1 + (v - peak) * HIGH_SPEED_TURN_FALLOFF);
      if (Math.abs(throttle) > 0.05) {
        speedFactor = Math.max(speedFactor, LOW_SPEED_TURN_FLOOR * Math.abs(throttle));
      }
      // Direction of travel flips the steering (reversing), but never
      // cancels it outright at v ~ 0 (sign(0) would deadlock the kart).
      const travelDir = Math.abs(vForward) > 0.5 ? Math.sign(vForward) : throttle >= 0 ? 1 : -1;
      kart.heading += steer * TUNING.kart.turnRate * speedFactor * travelDir * dt;
    }

    // (j) Recompose velocity in the (possibly rotated) local frame.
    FORWARD.set(Math.sin(kart.heading), 0, Math.cos(kart.heading));
    RIGHT.set(Math.cos(kart.heading), 0, -Math.sin(kart.heading));
    kart.velocity.set(
      FORWARD.x * vForward + RIGHT.x * vLateral,
      0,
      FORWARD.z * vForward + RIGHT.z * vLateral,
    );

    // (k) Integrate and query the track.
    kart.position.addScaledVector(kart.velocity, dt);
    const cp = this.track.closestPoint(kart.position, kart.splineHint);
    kart.splineHint = cp.distance;
    kart.surface = this.track.surfaceAt(cp);

    // (l) Invisible walls: reproject onto the limit and reflect the lateral
    // velocity in the track frame (XZ plane). No event for a wall scrape.
    const wallLimit = this.track.wallLimitAt(cp);
    if (Math.abs(cp.lateralOffset) > wallLimit) {
      const side = Math.sign(cp.lateralOffset);
      kart.position.copy(cp.position).addScaledVector(cp.right, side * wallLimit);
      // Horizontal track normal (cp.right may carry a slight Y component).
      const rLen = Math.hypot(cp.right.x, cp.right.z) || 1;
      const nx = cp.right.x / rLen;
      const nz = cp.right.z / rLen;
      const vLatTrack = kart.velocity.x * nx + kart.velocity.z * nz;
      // Along-track remainder keeps most of its speed; lateral part bounces.
      const fx = kart.velocity.x - vLatTrack * nx;
      const fz = kart.velocity.z - vLatTrack * nz;
      const bounce = -vLatTrack * TUNING.walls.restitution;
      kart.velocity.x = fx * TUNING.walls.forwardSpeedKeep + bounce * nx;
      kart.velocity.z = fz * TUNING.walls.forwardSpeedKeep + bounce * nz;
    }

    // (m) Ground snap (the drift hop is visual only, driven by hopTimer).
    kart.position.y = this.track.groundHeightAt(cp);
    kart.grounded = true;

    // (n) Safety-net respawn for aberrant positions.
    if (Math.abs(cp.lateralOffset) > TUNING.respawn.maxLateralDistance) {
      const sample = this.track.sampleAtDistance(kart.splineHint);
      kart.position.copy(sample.position);
      kart.velocity.set(0, 0, 0);
      kart.heading = Math.atan2(sample.forward.x, sample.forward.z);
      // Snap the interpolation snapshot too, so the render does not streak.
      kart.prevPosition.copy(kart.position);
      kart.prevHeading = kart.heading;
    }

    // (o) Derived scalars for the rest of the game (AI, HUD, rendering).
    FORWARD.set(Math.sin(kart.heading), 0, Math.cos(kart.heading));
    kart.speed = kart.velocity.dot(FORWARD);
    const slipTarget = kart.drift.active ? -kart.drift.direction * VISUAL_SLIP_MAX : 0;
    kart.visualSlip = damp(kart.visualSlip, slipTarget, VISUAL_SLIP_LAMBDA, dt);
  }
}
