import { TUNING } from '../config/tuning';

/**
 * Boucle fixed-timestep : simulate(dt) à 60 Hz, render(alpha, frameDt)
 * à chaque frame avec alpha d'interpolation.
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;

  constructor(
    private simulate: (dt: number) => void,
    private render: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = TUNING.sim.dt;
    let frameDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameDelta > TUNING.sim.maxFrameDelta) frameDelta = TUNING.sim.maxFrameDelta;

    this.accumulator += frameDelta;
    while (this.accumulator >= dt) {
      this.simulate(dt);
      this.accumulator -= dt;
    }
    this.render(this.accumulator / dt, frameDelta);
    requestAnimationFrame(this.frame);
  };
}
