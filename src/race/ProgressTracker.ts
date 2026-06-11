import type { EventBus } from '../core/EventBus';
import type { KartState } from '../types/kart';
import type { RaceState } from '../types/race';
import type { TrackData } from '../types/track';
import { mod } from '../core/MathUtils';

/** Seconds after the player finishes before remaining AIs are force-classified. */
const ALL_FINISHED_TIMEOUT = 30;

/**
 * Owns checkpoint validation, lap counting, the monotonic progress metric
 * and the live ranking. Writes kart.lap / nextCheckpoint / progress / rank /
 * finished / finishTime and race.standings exclusively.
 *
 * Lap convention: karts spawn BEHIND the finish line, so reset() sets lap = 0.
 * Crossing checkpoint 0 increments lap; lap == 1 is the real start of lap 1
 * (no event), lap > totalLaps means the kart finished. The HUD displays
 * max(lap, 1).
 */
export class ProgressTracker {
  private readonly track: TrackData;
  private readonly bus: EventBus;

  /** kartId -> definitive finish rank (1-based, contiguous). */
  private finishOrder = new Map<number, number>();
  private finishedCount = 0;
  /** race.raceTime at which the player finished (-1 = not yet). */
  private playerFinishRaceTime = -1;
  private allFinishedEmitted = false;

  constructor(trackData: TrackData, bus: EventBus) {
    this.track = trackData;
    this.bus = bus;
  }

  reset(karts: KartState[]): void {
    this.finishOrder.clear();
    this.finishedCount = 0;
    this.playerFinishRaceTime = -1;
    this.allFinishedEmitted = false;
    for (const kart of karts) {
      kart.lap = 0; // becomes 1 on the first finish-line crossing (real start)
      kart.nextCheckpoint = 0;
      kart.progress = 0;
      kart.rank = kart.id + 1; // grid order until the race provides data
      kart.finished = false;
      kart.finishTime = 0;
    }
  }

  update(karts: KartState[], race: RaceState): void {
    // Keep running during FINISHED so the remaining AIs really finish.
    if (race.phase !== 'RACING' && race.phase !== 'FINISHED') return;

    const checkpoints = this.track.checkpoints;
    const n = checkpoints.length;
    const totalLength = this.track.query.totalLength;

    for (const kart of karts) {
      if (kart.finished) continue;
      this.detectCrossings(kart, race, n);
      if (!kart.finished) this.updateProgress(kart, n, totalLength);
    }

    this.updateRanks(karts, race);
    this.checkAllFinished(karts, race);
  }

  /** Checkpoint gate crossings — only the expected gate counts (anti-cheat). */
  private detectCrossings(kart: KartState, race: RaceState, n: number): void {
    const checkpoints = this.track.checkpoints;
    // Chain-guard: a fast kart may cross two gates in one fixed step.
    for (let guard = 0; guard < n; guard++) {
      const cp = checkpoints[kart.nextCheckpoint];
      const fx = cp.forward.x;
      const fz = cp.forward.z;
      // Signed distance to the gate plane (XZ only).
      const signPrev =
        (kart.prevPosition.x - cp.position.x) * fx +
        (kart.prevPosition.z - cp.position.z) * fz;
      const signCurr =
        (kart.position.x - cp.position.x) * fx +
        (kart.position.z - cp.position.z) * fz;
      if (!(signPrev < 0 && signCurr >= 0)) break;
      // Lateral bound: perpendicular to forward in the XZ plane.
      const lateral =
        (kart.position.x - cp.position.x) * fz -
        (kart.position.z - cp.position.z) * fx;
      if (Math.abs(lateral) >= cp.halfWidth) break;

      const crossedIndex = kart.nextCheckpoint;
      kart.nextCheckpoint = (crossedIndex + 1) % n;

      if (crossedIndex === 0) {
        kart.lap += 1;
        if (kart.lap > race.totalLaps) {
          kart.finished = true;
          kart.finishTime = race.raceTime;
          this.finishedCount += 1;
          this.finishOrder.set(kart.id, this.finishedCount);
          if (kart.isPlayer) this.playerFinishRaceTime = race.raceTime;
          this.bus.emit('race:finish', {
            kartId: kart.id,
            rank: this.finishedCount,
            time: kart.finishTime,
          });
          break;
        }
        // lap == 1 is the real start of lap 1: no event.
        if (kart.lap > 1) {
          this.bus.emit('race:lap', { kartId: kart.id, lap: kart.lap });
        }
      }
    }
  }

  /**
   * Monotonic progress: full laps + spline abscissa of the last validated
   * checkpoint + clamped distance travelled inside the current segment.
   * With lap = 0 before the start the base is negative, which keeps the
   * metric continuous across the finish line at the launch.
   */
  private updateProgress(kart: KartState, n: number, totalLength: number): void {
    const checkpoints = this.track.checkpoints;
    const prevIndex = (kart.nextCheckpoint + n - 1) % n;
    const prevDist = checkpoints[prevIndex].splineDistance;
    const nextDist = checkpoints[kart.nextCheckpoint].splineDistance;
    const segLength = mod(nextDist - prevDist, totalLength) || totalLength;

    // Spline distance covered since the previous checkpoint (wrap-safe).
    let bonus = mod(kart.splineHint - prevDist, totalLength);
    if (bonus > segLength) {
      // Outside the segment: snap to the nearer end of it.
      bonus = bonus - segLength < totalLength - bonus ? segLength : 0;
    }

    // Decreases are only possible inside the segment bounds (real reversing).
    kart.progress = (kart.lap - 1) * totalLength + prevDist + bonus;
  }

  /** Finished karts keep their definitive rank; others sort by progress. */
  private updateRanks(karts: KartState[], race: RaceState): void {
    const order = [...karts].sort((a, b) => {
      const fa = this.finishOrder.get(a.id);
      const fb = this.finishOrder.get(b.id);
      if (fa !== undefined && fb !== undefined) return fa - fb;
      if (fa !== undefined) return -1;
      if (fb !== undefined) return 1;
      return b.progress - a.progress;
    });

    race.standings.length = 0;
    for (let i = 0; i < order.length; i++) {
      const kart = order[i];
      // Finish ranks are contiguous from 1, so index + 1 matches them.
      kart.rank = i + 1;
      race.standings.push({
        kartId: kart.id,
        rank: kart.rank,
        finished: kart.finished,
        finishTime: kart.finishTime,
      });
    }
  }

  /** All 8 finished, or 30 s grace after the player's arrival. */
  private checkAllFinished(karts: KartState[], race: RaceState): void {
    if (this.allFinishedEmitted) return;
    const everyoneDone = karts.every((k) => k.finished);
    const timedOut =
      this.playerFinishRaceTime >= 0 &&
      race.raceTime - this.playerFinishRaceTime >= ALL_FINISHED_TIMEOUT;
    if (everyoneDone || timedOut) {
      this.allFinishedEmitted = true;
      // Remaining AIs (if any) are already ranked by progress in standings.
      this.bus.emit('race:allFinished', {});
    }
  }
}
