import type { KartState } from '../types/kart';
import { ItemType } from '../types/items';
import { angleDiff } from '../core/MathUtils';
import { TUNING } from '../config/tuning';

/**
 * Internal helper of the AI module: decides when an AI kart presses the item
 * button. Only AIDriver should instantiate this class.
 *
 * The item button is pressed for a few consecutive ticks (HOLD_TICKS) so the
 * ItemSystem reliably sees a rising edge.
 */

/** Ticks during which useItem stays true once a decision is made. */
const HOLD_TICKS = 3;

/** Minimum time between receiving an item and using it ("reaction time"). */
const REFLEX_DELAY = 0.5;

/** Green shell aim cone (~15 degrees) and range. */
const GREEN_SHELL_CONE = (15 * Math.PI) / 180;
const GREEN_SHELL_RANGE = 30;
const GREEN_SHELL_RANGE_SQ = GREEN_SHELL_RANGE * GREEN_SHELL_RANGE;

/** Fire probabilities (per second). */
const GREEN_SHELL_AIMED_RATE = 0.4;
const GREEN_SHELL_BLIND_RATE = 0.05;
const BANANA_TURN_RATE = 0.45;
const BANANA_STRAIGHT_RATE = 0.12;

/** Upcoming turn below this is considered "straight enough" for a mushroom. */
const MUSHROOM_STRAIGHT_TURN = 0.25;

/** Upcoming turn above this counts as "in/near a corner" for banana drops. */
const BANANA_TURN_THRESHOLD = 0.35;

export class AIItemUser {
  /** Remaining ticks of button hold per kart. */
  private holdTicks: number[] = [];
  /** Seconds elapsed since the current item was acquired. */
  private sinceItem: number[] = [];
  /** Last seen held item, to detect a new acquisition. */
  private prevItem: (ItemType | null)[] = [];
  /** Last seen spinTimer, to detect "spin just ended". */
  private prevSpin: number[] = [];

  /** Lazily (re)sizes the per-kart state arrays. */
  ensureSize(count: number): void {
    while (this.holdTicks.length < count) {
      this.holdTicks.push(0);
      this.sinceItem.push(0);
      this.prevItem.push(null);
      this.prevSpin.push(0);
    }
  }

  reset(): void {
    for (let i = 0; i < this.holdTicks.length; i++) {
      this.holdTicks[i] = 0;
      this.sinceItem[i] = 0;
      this.prevItem[i] = null;
      this.prevSpin[i] = 0;
    }
  }

  /**
   * Returns the useItem flag for this kart on this tick.
   * @param turnAhead total upcoming curvature (radians), from RacingLine.
   */
  update(
    kart: KartState,
    index: number,
    karts: KartState[],
    turnAhead: number,
    dt: number,
  ): boolean {
    // --- Bookkeeping (always runs, even while holding the button). ---
    const spinJustEnded = this.prevSpin[index] > 0 && kart.spinTimer <= 0;
    this.prevSpin[index] = kart.spinTimer;

    if (kart.heldItem !== this.prevItem[index]) {
      this.prevItem[index] = kart.heldItem;
      this.sinceItem[index] = 0;
    } else {
      this.sinceItem[index] += dt;
    }

    // Keep the button pressed for the remaining hold ticks.
    if (this.holdTicks[index] > 0) {
      this.holdTicks[index]--;
      return true;
    }

    const item = kart.heldItem;
    if (item === null) return false;
    // Reaction delay + never fire while the roulette is still spinning.
    if (kart.rouletteTimer > 0 || this.sinceItem[index] < REFLEX_DELAY) return false;

    if (this.shouldUse(kart, item, karts, turnAhead, spinJustEnded, dt)) {
      this.holdTicks[index] = HOLD_TICKS - 1;
      return true;
    }
    return false;
  }

  private shouldUse(
    kart: KartState,
    item: ItemType,
    karts: KartState[],
    turnAhead: number,
    spinJustEnded: boolean,
    dt: number,
  ): boolean {
    switch (item) {
      case ItemType.MUSHROOM:
        // Always burn it immediately when far behind.
        if (kart.rank >= 6) return true;
        // Otherwise on a straight, or right after recovering from a hit.
        return turnAhead < MUSHROOM_STRAIGHT_TURN || spinJustEnded;

      case ItemType.RED_SHELL: {
        // Fire at the kart directly ahead in the standings if within range.
        const targetRank = kart.rank - 1;
        if (targetRank < 1) return false;
        for (let i = 0; i < karts.length; i++) {
          const other = karts[i];
          if (other.id === kart.id || other.rank !== targetRank) continue;
          const gap = other.progress - kart.progress;
          return gap > 0 && gap < TUNING.ai.redShellRange;
        }
        return false;
      }

      case ItemType.GREEN_SHELL: {
        // Higher fire rate when someone sits roughly in front of the nose.
        const rate = this.hasKartInCone(kart, karts)
          ? GREEN_SHELL_AIMED_RATE
          : GREEN_SHELL_BLIND_RATE;
        return Math.random() < rate * dt;
      }

      case ItemType.BANANA: {
        // Prefer dropping just before / inside a corner.
        const rate =
          turnAhead > BANANA_TURN_THRESHOLD ? BANANA_TURN_RATE : BANANA_STRAIGHT_RATE;
        return Math.random() < rate * dt;
      }

      case ItemType.STAR:
      case ItemType.COIN:
        // No reason to hold these.
        return true;
    }
  }

  /** True if some other kart is within ~15 degrees of the heading and < 30 m. */
  private hasKartInCone(kart: KartState, karts: KartState[]): boolean {
    for (let i = 0; i < karts.length; i++) {
      const other = karts[i];
      if (other.id === kart.id) continue;
      const dx = other.position.x - kart.position.x;
      const dz = other.position.z - kart.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > GREEN_SHELL_RANGE_SQ || distSq < 1e-6) continue;
      const bearing = Math.atan2(dx, dz);
      if (Math.abs(angleDiff(bearing, kart.heading)) < GREEN_SHELL_CONE) return true;
    }
    return false;
  }
}
