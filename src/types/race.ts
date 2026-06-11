export type RacePhase = 'TITLE' | 'COUNTDOWN' | 'RACING' | 'FINISHED';

export interface StandingEntry {
  kartId: number;
  rank: number;
  finished: boolean;
  finishTime: number;
}

export interface RaceState {
  phase: RacePhase;
  /** 3, 2, 1, 0 (= GO) pendant le countdown. */
  countdownValue: number;
  /** Temps de course écoulé depuis le GO (secondes). */
  raceTime: number;
  totalLaps: number;
  /** Trié par rang croissant. */
  standings: StandingEntry[];
}

export function createRaceState(totalLaps: number, kartCount: number): RaceState {
  return {
    phase: 'TITLE',
    countdownValue: 3,
    raceTime: 0,
    totalLaps,
    standings: Array.from({ length: kartCount }, (_, i) => ({
      kartId: i,
      rank: i + 1,
      finished: false,
      finishTime: 0,
    })),
  };
}
