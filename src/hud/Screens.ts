import type { EventBus } from '../core/EventBus';
import type { KartState } from '../types/kart';
import type { RaceState } from '../types/race';
import { TUNING } from '../config/tuning';
import { formatRaceTime } from './Hud';

const STYLE_ID = 'screens-style';
const CSS = `
.scr-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Trebuchet MS', 'Segoe UI', sans-serif;
  color: #fff;
}
/* --- Title screen --- */
.scr-title {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  background: linear-gradient(160deg, #2b6cee 0%, #7a3df0 45%, #f0508a 100%);
}
.scr-title h1 {
  margin: 0;
  font-size: clamp(48px, 9vw, 110px);
  font-style: italic;
  letter-spacing: 4px;
  color: #ffd640;
  -webkit-text-stroke: 4px #20204a;
  text-shadow: 0 8px 0 rgba(0, 0, 0, 0.35);
  transform: rotate(-3deg);
}
.scr-controls {
  font-size: 20px;
  font-weight: bold;
  text-align: center;
  line-height: 1.7;
  background: rgba(10, 10, 30, 0.45);
  border-radius: 16px;
  padding: 14px 30px;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
}
.scr-go-btn {
  pointer-events: auto;
  cursor: pointer;
  font: inherit;
  font-size: 40px;
  font-weight: bold;
  font-style: italic;
  letter-spacing: 3px;
  color: #fff;
  background: linear-gradient(180deg, #4cd964, #1f9e3c);
  border: 5px solid #fff;
  border-radius: 22px;
  padding: 16px 70px;
  box-shadow: 0 8px 0 rgba(0, 0, 0, 0.35);
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.4);
  transition: transform 0.1s;
}
.scr-go-btn:hover { transform: scale(1.07); }
.scr-go-btn:active { transform: scale(0.96); }
/* --- Countdown --- */
.scr-countdown {
  position: absolute;
  left: 50%;
  top: 38%;
  transform: translate(-50%, -50%);
  font-size: 150px;
  font-weight: bold;
  font-style: italic;
  color: #ffd640;
  -webkit-text-stroke: 6px #20204a;
  text-shadow: 0 10px 0 rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.scr-countdown.go { color: #4cd964; }
.scr-countdown.anim {
  animation: scr-cd 0.9s ease-out forwards;
}
@keyframes scr-cd {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(2.2); }
  18% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  75% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
}
/* --- Lap banner --- */
.scr-banner {
  position: absolute;
  left: 50%;
  top: 18%;
  transform: translateX(-50%) scale(0.6);
  font-size: 52px;
  font-weight: bold;
  font-style: italic;
  -webkit-text-stroke: 3px #20204a;
  text-shadow: 0 5px 0 rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: opacity 0.2s, transform 0.2s;
  pointer-events: none;
}
.scr-banner.show {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}
/* --- Results --- */
.scr-results {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 30, 0.55);
}
.scr-results-panel {
  background: linear-gradient(180deg, #2a2a55, #1b1b3a);
  border: 4px solid rgba(255, 255, 255, 0.8);
  border-radius: 24px;
  padding: 26px 40px;
  min-width: 380px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
  text-align: center;
}
.scr-results-panel h2 {
  margin: 0 0 16px;
  font-size: 38px;
  font-style: italic;
  color: #ffd640;
  letter-spacing: 3px;
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.5);
}
.scr-results-row {
  display: flex;
  gap: 14px;
  align-items: baseline;
  font-size: 21px;
  font-weight: bold;
  padding: 4px 12px;
  border-radius: 10px;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
}
.scr-results-row.player {
  background: rgba(255, 214, 64, 0.25);
  color: #ffd640;
}
.scr-results-rank { width: 34px; text-align: right; }
.scr-results-name { flex: 1; text-align: left; }
.scr-results-time { font-variant-numeric: tabular-nums; }
.scr-restart-btn {
  pointer-events: auto;
  cursor: pointer;
  margin-top: 20px;
  font: inherit;
  font-size: 26px;
  font-weight: bold;
  letter-spacing: 2px;
  color: #fff;
  background: linear-gradient(180deg, #4c9df0, #2058b8);
  border: 4px solid #fff;
  border-radius: 16px;
  padding: 10px 44px;
  box-shadow: 0 6px 0 rgba(0, 0, 0, 0.35);
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.4);
  transition: transform 0.1s;
}
.scr-restart-btn:hover { transform: scale(1.06); }
.scr-restart-btn:active { transform: scale(0.96); }
`;

/**
 * Full-screen overlays: title screen, countdown numbers, lap banner and the
 * final results panel. The container is pointer-events:none; only the two
 * buttons re-enable pointer events.
 */
export class Screens {
  private readonly titleEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly resultsEl: HTMLDivElement;
  private readonly resultsRowsEl: HTMLDivElement;

  private startCb: (() => void) | null = null;
  private restartCb: (() => void) | null = null;

  private resultsVisible = false;
  /** Standings fingerprint, to rebuild result rows only when they change. */
  private resultsSignature = '';
  private countdownHideTimer = 0;
  private bannerHideTimer = 0;

  constructor(container: HTMLElement, bus: EventBus) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    // --- Title ---
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'scr-layer scr-title';
    this.titleEl.style.display = 'none';
    const h1 = document.createElement('h1');
    h1.textContent = 'KART RACER 3D';
    const controls = document.createElement('div');
    controls.className = 'scr-controls';
    controls.innerHTML =
      'Flèches / ZQSD — conduire<br>MAJ — drift &nbsp;•&nbsp; ESPACE — objet';
    const goBtn = document.createElement('button');
    goBtn.className = 'scr-go-btn';
    goBtn.textContent = 'GO !';
    goBtn.addEventListener('click', () => {
      this.titleEl.style.display = 'none';
      this.startCb?.();
    });
    this.titleEl.append(h1, controls, goBtn);

    // --- Countdown ---
    this.countdownEl = document.createElement('div');
    this.countdownEl.className = 'scr-countdown';
    this.countdownEl.style.display = 'none';

    // --- Lap banner ---
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'scr-banner';

    // --- Results ---
    this.resultsEl = document.createElement('div');
    this.resultsEl.className = 'scr-layer scr-results';
    this.resultsEl.style.display = 'none';
    const panel = document.createElement('div');
    panel.className = 'scr-results-panel';
    const h2 = document.createElement('h2');
    h2.textContent = 'RÉSULTATS';
    this.resultsRowsEl = document.createElement('div');
    const restartBtn = document.createElement('button');
    restartBtn.className = 'scr-restart-btn';
    restartBtn.textContent = 'REJOUER';
    restartBtn.addEventListener('click', () => {
      this.hideResults();
      this.restartCb?.();
    });
    panel.append(h2, this.resultsRowsEl, restartBtn);
    this.resultsEl.appendChild(panel);

    container.append(this.titleEl, this.countdownEl, this.bannerEl, this.resultsEl);

    // --- Event subscriptions ---
    bus.on('race:countdown', ({ value }) => this.flashCountdown(String(value), false));
    bus.on('race:start', () => {
      this.flashCountdown('GO!', true);
      window.clearTimeout(this.countdownHideTimer);
      this.countdownHideTimer = window.setTimeout(() => {
        this.countdownEl.style.display = 'none';
      }, 800);
    });
    bus.on('race:lap', ({ kartId, lap }) => {
      if (kartId !== 0) return; // player only
      if (lap === TUNING.race.totalLaps) {
        this.showBanner('DERNIER TOUR !', '#ff9a2e');
      } else {
        this.showBanner(`TOUR ${lap}/${TUNING.race.totalLaps}`, '#ffffff');
      }
    });
  }

  onStart(cb: () => void): void {
    this.startCb = cb;
  }

  onRestart(cb: () => void): void {
    this.restartCb = cb;
  }

  showTitle(): void {
    this.hideResults();
    this.countdownEl.style.display = 'none';
    this.titleEl.style.display = '';
  }

  update(race: RaceState, karts: KartState[]): void {
    if (race.phase === 'FINISHED') {
      this.refreshResults(race, karts);
      if (!this.resultsVisible) {
        this.resultsVisible = true;
        this.resultsEl.style.display = '';
      }
    } else if (this.resultsVisible) {
      this.hideResults();
    }
  }

  // --- internals ---

  private flashCountdown(text: string, isGo: boolean): void {
    window.clearTimeout(this.countdownHideTimer);
    this.countdownEl.style.display = '';
    this.countdownEl.textContent = text;
    this.countdownEl.classList.toggle('go', isGo);
    // Restart the pop animation.
    this.countdownEl.classList.remove('anim');
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add('anim');
  }

  private showBanner(text: string, color: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = color;
    this.bannerEl.classList.add('show');
    window.clearTimeout(this.bannerHideTimer);
    this.bannerHideTimer = window.setTimeout(() => {
      this.bannerEl.classList.remove('show');
    }, 1700);
  }

  private hideResults(): void {
    this.resultsVisible = false;
    this.resultsSignature = '';
    this.resultsEl.style.display = 'none';
  }

  /** Rebuilds the ranking rows only when standings actually change. */
  private refreshResults(race: RaceState, karts: KartState[]): void {
    const signature = race.standings
      .map((s) => `${s.kartId}:${s.finished ? s.finishTime.toFixed(2) : 'x'}`)
      .join('|');
    if (signature === this.resultsSignature) return;
    this.resultsSignature = signature;

    const nameById = new Map<number, string>();
    for (const kart of karts) nameById.set(kart.id, kart.name);

    this.resultsRowsEl.textContent = '';
    for (const entry of race.standings) {
      const row = document.createElement('div');
      row.className = 'scr-results-row' + (entry.kartId === 0 ? ' player' : '');
      const rank = document.createElement('span');
      rank.className = 'scr-results-rank';
      rank.textContent = `${entry.rank}.`;
      const name = document.createElement('span');
      name.className = 'scr-results-name';
      name.textContent = nameById.get(entry.kartId) ?? `Kart ${entry.kartId + 1}`;
      const time = document.createElement('span');
      time.className = 'scr-results-time';
      time.textContent = entry.finished ? formatRaceTime(entry.finishTime) : '—';
      row.append(rank, name, time);
      this.resultsRowsEl.appendChild(row);
    }
  }
}
