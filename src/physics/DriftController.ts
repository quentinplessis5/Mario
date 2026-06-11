import type { KartState, DriftDirection } from '../types/kart';
import { EventBus } from '../core/EventBus';
import { TUNING } from '../config/tuning';
import { clamp } from '../core/MathUtils';

/**
 * Once started, a drift survives down to this fraction of the start speed
 * (hysteresis so a small slowdown mid-corner does not cancel the drift).
 */
const DRIFT_KEEP_SPEED_RATIO = 0.6;

/**
 * Drift state machine. A single shared instance operates on the per-kart
 * `kart.drift` state; it owns the heading while a drift is active.
 */
export class DriftController {
  constructor(private readonly bus: EventBus) {}

  /**
   * Advances the drift state machine for one kart for one fixed tick.
   *
   * @param driftHeld Drift button held (already forced to false during a spin).
   * @param steer     Effective steer input in [-1, 1].
   * @param vForward  Signed forward speed (m/s).
   * @returns true when the drift owned the heading this tick (the caller must
   *          then skip its normal steering integration).
   */
  update(
    kart: KartState,
    driftHeld: boolean,
    steer: number,
    vForward: number,
    dt: number,
  ): boolean {
    const d = kart.drift;

    if (!d.active) {
      // Trigger edge: button held while not drifting, with enough steer & speed.
      const canStart =
        driftHeld &&
        Math.abs(steer) >= TUNING.drift.minSteer &&
        vForward >= TUNING.drift.minSpeed &&
        kart.spinTimer <= 0;
      if (!canStart) return false;
      d.active = true;
      d.direction = (steer > 0 ? 1 : -1) as DriftDirection;
      d.chargeTime = 0;
      d.miniTurboLevel = 0;
      d.hopTimer = TUNING.drift.hopDuration;
    } else if (
      !driftHeld ||
      vForward < TUNING.drift.minSpeed * DRIFT_KEEP_SPEED_RATIO ||
      kart.spinTimer > 0
    ) {
      this.release(kart);
      return false;
    }

    // Active drift: heading follows the drift formula. Steering into the
    // drift direction (blend -> 1) tightens the turn and charges faster;
    // steering against it (blend -> 0) opens the line.
    const blend = clamp((steer * d.direction + 1) / 2, 0, 1);
    const headingRate =
      d.direction * (TUNING.drift.baseTurnRate + blend * TUNING.drift.steerTurnRange);
    kart.heading += headingRate * dt;
    d.chargeTime += dt * (1 + TUNING.drift.tightChargeBonus * blend);

    // Mini-turbo level transitions (each fires exactly once per drift).
    if (d.miniTurboLevel === 0 && d.chargeTime >= TUNING.drift.miniTurbo1Time) {
      d.miniTurboLevel = 1;
      this.bus.emit('kart:driftCharge', { kartId: kart.id, level: 1 });
    } else if (d.miniTurboLevel === 1 && d.chargeTime >= TUNING.drift.miniTurbo2Time) {
      d.miniTurboLevel = 2;
      this.bus.emit('kart:driftCharge', { kartId: kart.id, level: 2 });
    }

    return true;
  }

  /** Ends the drift, granting the mini-turbo boost if charged enough. */
  private release(kart: KartState): void {
    const d = kart.drift;
    const level = d.miniTurboLevel;
    if (level === 1 || level === 2) {
      kart.boostTimer = Math.max(kart.boostTimer, TUNING.drift.boostDurations[level]);
      this.bus.emit('kart:boost', { kartId: kart.id, level });
    }
    d.active = false;
    d.direction = 0;
    d.chargeTime = 0;
    d.miniTurboLevel = 0;
    // hopTimer is left as-is: it is purely visual and decays on its own.
  }
}
