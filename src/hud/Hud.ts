import type { EventBus } from '../core/EventBus';
import type { KartState } from '../types/kart';
import type { RaceState } from '../types/race';

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const PODIUM_COLORS: Record<number, string> = {
  1: '#ffd640',
  2: '#d4dbe6',
  3: '#e0884a',
};

/** mm:ss.cc race clock formatting (shared with the results screen). */
export function formatRaceTime(seconds: number): string {
  const t = Math.max(0, seconds);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t * 100) % 100);
  const pad = (v: number): string => v.toString().padStart(2, '0');
  return `${pad(m)}:${pad(s)}.${pad(c)}`;
}

const STYLE_ID = 'hud-style';
const CSS = `
.hud-root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Trebuchet MS', 'Segoe UI', sans-serif;
  font-weight: bold;
  color: #fff;
}
.hud-rank {
  position: absolute;
  right: 24px;
  bottom: 16px;
  font-size: 84px;
  font-style: italic;
  letter-spacing: 2px;
  -webkit-text-stroke: 3px #1a1a2e;
  text-shadow: 0 5px 0 rgba(0, 0, 0, 0.45);
  line-height: 1;
}
.hud-lap {
  position: absolute;
  right: 24px;
  top: 18px;
  font-size: 30px;
  padding: 6px 16px;
  background: rgba(20, 20, 40, 0.55);
  border-radius: 14px;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
}
.hud-time {
  position: absolute;
  left: 50%;
  top: 16px;
  transform: translateX(-50%);
  font-size: 30px;
  font-variant-numeric: tabular-nums;
  padding: 6px 18px;
  background: rgba(20, 20, 40, 0.55);
  border-radius: 14px;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
}
.hud-coins {
  position: absolute;
  left: 18px;
  top: 122px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 26px;
  padding: 5px 14px 5px 8px;
  background: rgba(20, 20, 40, 0.55);
  border-radius: 14px;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
}
.hud-coin-icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 32%, #ffe98a, #f5b81d 60%, #b87b00);
  border: 2px solid #8a5c00;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
`;

/**
 * Arcade-style race HUD: rank (bottom right), lap counter (top right),
 * coin counter (top left, below the item slot), race clock (top center).
 * DOM is built once; text nodes only change when their value changes.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly rankEl: HTMLDivElement;
  private readonly lapEl: HTMLDivElement;
  private readonly timeEl: HTMLDivElement;
  private readonly coinsEl: HTMLSpanElement;

  // Last rendered values, to skip useless DOM writes.
  private lastRank = -1;
  private lastLap = -1;
  private lastTotalLaps = -1;
  private lastCoins = -1;
  private lastTime = '';

  constructor(container: HTMLElement, _bus: EventBus) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = document.createElement('div');
    this.root.className = 'hud-root';

    this.rankEl = document.createElement('div');
    this.rankEl.className = 'hud-rank';

    this.lapEl = document.createElement('div');
    this.lapEl.className = 'hud-lap';

    this.timeEl = document.createElement('div');
    this.timeEl.className = 'hud-time';

    const coins = document.createElement('div');
    coins.className = 'hud-coins';
    const coinIcon = document.createElement('span');
    coinIcon.className = 'hud-coin-icon';
    this.coinsEl = document.createElement('span');
    coins.append(coinIcon, this.coinsEl);

    this.root.append(this.rankEl, this.lapEl, this.timeEl, coins);
    container.appendChild(this.root);
  }

  update(race: RaceState, player: KartState): void {
    // Rank (1st..8th, podium colors).
    if (player.rank !== this.lastRank) {
      this.lastRank = player.rank;
      this.rankEl.textContent = ORDINALS[player.rank - 1] ?? `${player.rank}th`;
      this.rankEl.style.color = PODIUM_COLORS[player.rank] ?? '#ffffff';
    }

    // Lap (lap 0 = pre-start, displayed as 1).
    const lap = Math.min(Math.max(player.lap, 1), race.totalLaps);
    if (lap !== this.lastLap || race.totalLaps !== this.lastTotalLaps) {
      this.lastLap = lap;
      this.lastTotalLaps = race.totalLaps;
      this.lapEl.textContent = `TOUR ${lap}/${race.totalLaps}`;
    }

    // Race clock (frozen at the player's time once finished).
    const clock = formatRaceTime(player.finished ? player.finishTime : race.raceTime);
    if (clock !== this.lastTime) {
      this.lastTime = clock;
      this.timeEl.textContent = clock;
    }

    // Coins.
    if (player.coins !== this.lastCoins) {
      this.lastCoins = player.coins;
      this.coinsEl.textContent = `×${player.coins}`;
    }
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }
}
