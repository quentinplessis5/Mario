import type { EventBus } from '../core/EventBus';
import type { KartState } from '../types/kart';
import type { RaceState } from '../types/race';
import { TUNING } from '../config/tuning';
import { clamp, damp } from '../core/MathUtils';

const MASTER_GAIN = 0.5;
const PLAYER_ID = 0;

/**
 * Fully synthesized WebAudio: engine drone + event jingles.
 * The AudioContext is created lazily in resume() (browser autoplay policy);
 * every method is a safe no-op until then.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  // Engine voice
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private enginePitch = 60;

  // Star loop state
  private starStep = 0;
  private starNextTime = 0;
  // Roulette ticking
  private rouletteNextTick = 0;

  constructor(bus: EventBus) {
    bus.on('race:countdown', ({ value }) => {
      if (value > 0) this.beep(440, 0.12, 'square', 0.25);
    });
    bus.on('race:start', () => this.beep(880, 0.45, 'square', 0.3));
    bus.on('coin:collected', ({ kartId }) => {
      if (kartId !== PLAYER_ID) return;
      this.beep(988, 0.07, 'square', 0.18);
      this.beep(1319, 0.12, 'square', 0.18, 0.07);
    });
    bus.on('coin:lost', ({ kartId }) => {
      if (kartId === PLAYER_ID) this.beep(620, 0.1, 'sawtooth', 0.12);
    });
    bus.on('item:awarded', ({ kartId }) => {
      if (kartId === PLAYER_ID) this.beep(1175, 0.15, 'triangle', 0.22);
    });
    bus.on('item:used', ({ kartId }) => {
      if (kartId === PLAYER_ID) this.whoosh();
    });
    bus.on('kart:boost', ({ kartId, level }) => {
      if (kartId === PLAYER_ID) this.boostSweep(level);
    });
    bus.on('kart:hit', ({ kartId }) => {
      if (kartId === PLAYER_ID) this.crash();
    });
    bus.on('kart:driftCharge', ({ kartId, level }) => {
      if (kartId === PLAYER_ID) this.beep(level === 1 ? 740 : 1047, 0.08, 'square', 0.15);
    });
    bus.on('race:lap', ({ kartId, lap }) => {
      if (kartId !== PLAYER_ID) return;
      if (lap === TUNING.race.totalLaps) this.lastLapJingle();
      else this.beep(784, 0.15, 'triangle', 0.2);
    });
    bus.on('race:finish', ({ kartId, rank }) => {
      if (kartId === PLAYER_ID) this.fanfare(rank <= 3);
    });
  }

  /** Create/resume the AudioContext. Call from a user gesture (GO click). */
  resume(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return; // No audio support: stay silent.
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(this.ctx.destination);
      this.startEngine();
    }
    void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : MASTER_GAIN;
  }

  update(player: KartState, race: RaceState, frameDt: number): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain) return;
    const t = this.ctx.currentTime;

    // Engine pitch follows speed; boost raises it further. Small vibrato.
    const speedRatio = clamp(Math.abs(player.speed) / TUNING.kart.maxSpeed, 0, 1.3);
    const boost = player.boostTimer > 0 ? 35 : 0;
    const target = 60 + speedRatio * 160 + boost;
    this.enginePitch = damp(this.enginePitch, target, 6, frameDt);
    const vibrato = Math.sin(t * 31) * 2.5;
    this.engineOsc.frequency.setValueAtTime(this.enginePitch + vibrato, t);
    const running = race.phase === 'RACING' || race.phase === 'FINISHED';
    this.engineGain.gain.setTargetAtTime(running ? 0.08 : 0.04, t, 0.1);

    // Star arpeggio loop while the player is invincible.
    if (player.starTimer > 0 && t >= this.starNextTime) {
      const scale = [659, 784, 988, 1319];
      this.beep(scale[this.starStep % scale.length], 0.09, 'square', 0.12);
      this.starStep++;
      this.starNextTime = t + 0.11;
    }

    // Roulette ticking.
    if (player.rouletteTimer > 0 && t >= this.rouletteNextTick) {
      this.beep(1568, 0.03, 'square', 0.08);
      this.rouletteNextTick = t + 0.09;
    }
  }

  // --- Voices -------------------------------------------------------------

  private startEngine(): void {
    if (!this.ctx || !this.master) return;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = this.enginePitch;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 650;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.04;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
  }

  /** Short tone with exponential decay. */
  private beep(
    freq: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** Filtered noise burst (item throw). */
  private whoosh(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = 0.25;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.exponentialRampToValueAtTime(2400, t + len);
    const g = this.ctx.createGain();
    g.gain.value = 0.22;
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  /** Rising sweep, stronger for higher boost levels. */
  private boostSweep(level: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(500 + level * 180, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  /** Dissonant falling tone (hit/spin). */
  private crash(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    for (const [f0, f1] of [[400, 90], [520, 120]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + 0.5);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.6);
    }
  }

  private lastLapJingle(): void {
    const notes = [784, 784, 988];
    notes.forEach((f, i) => this.beep(f, 0.12, 'square', 0.22, i * 0.13));
  }

  private fanfare(podium: boolean): void {
    const notes = podium ? [523, 659, 784, 1047, 1319] : [392, 370, 349, 330];
    notes.forEach((f, i) => this.beep(f, 0.22, 'triangle', 0.25, i * 0.18));
  }
}
