import type { EventBus } from '../core/EventBus';
import type { KartState } from '../types/kart';
import type { RaceState } from '../types/race';
import { TUNING } from '../config/tuning';

/**
 * Drives the race phase state machine:
 * TITLE -> COUNTDOWN (3, 2, 1) -> RACING -> FINISHED (results).
 * The transition to FINISHED happens TUNING.race.resultsDelay seconds after
 * the player crosses the line; raceTime keeps advancing in FINISHED so the
 * remaining AIs record real finish times.
 */
export class RaceManager {
  private readonly bus: EventBus;
  /** Time left in the current countdown step. */
  private countdownTimer = 0;
  /** Delay before showing results once the player finished (-1 = inactive). */
  private resultsTimer = -1;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  startCountdown(race: RaceState): void {
    race.phase = 'COUNTDOWN';
    race.countdownValue = 3;
    this.countdownTimer = TUNING.race.countdownStepDuration;
    this.resultsTimer = -1;
    this.bus.emit('race:countdown', { value: 3 });
  }

  update(race: RaceState, karts: KartState[], dt: number): void {
    switch (race.phase) {
      case 'COUNTDOWN': {
        this.countdownTimer -= dt;
        if (this.countdownTimer <= 0) {
          race.countdownValue -= 1;
          if (race.countdownValue <= 0) {
            race.countdownValue = 0;
            race.phase = 'RACING';
            this.bus.emit('race:start', {});
          } else {
            this.countdownTimer += TUNING.race.countdownStepDuration;
            this.bus.emit('race:countdown', { value: race.countdownValue });
          }
        }
        break;
      }
      case 'RACING': {
        race.raceTime += dt;
        const player = karts.find((k) => k.isPlayer);
        if (player?.finished) {
          if (this.resultsTimer < 0) this.resultsTimer = TUNING.race.resultsDelay;
          this.resultsTimer -= dt;
          if (this.resultsTimer <= 0) race.phase = 'FINISHED';
        }
        break;
      }
      case 'FINISHED': {
        // Keep the clock running so late AI finishes get real times.
        race.raceTime += dt;
        break;
      }
      case 'TITLE':
        break;
    }
  }

  /** True outside RACING: physics should receive neutral inputs. */
  isControlLocked(race: RaceState): boolean {
    return race.phase !== 'RACING';
  }

  resetRace(race: RaceState): void {
    race.phase = 'TITLE';
    race.countdownValue = 3;
    race.raceTime = 0;
    this.countdownTimer = 0;
    this.resultsTimer = -1;
    // Restore initial grid standings.
    for (let i = 0; i < race.standings.length; i++) {
      const entry = race.standings[i];
      entry.kartId = i;
      entry.rank = i + 1;
      entry.finished = false;
      entry.finishTime = 0;
    }
  }
}
