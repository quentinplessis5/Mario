import type { KartState } from '../types/kart';
import type { TrackData } from '../types/track';

const SIZE = 180;
const MARGIN = 10;

/**
 * Bottom-left minimap: track outline drawn from the sampled center line,
 * finish line tick, one colored dot per kart (player bigger, white ring).
 * The 180x180 canvas is fully redrawn each frame.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly outlinePath: Path2D;
  private readonly finish: { x1: number; y1: number; x2: number; y2: number };
  // World -> canvas transform (uniform scale, centered).
  private readonly scale: number;
  private readonly offsetX: number;
  private readonly offsetY: number;

  constructor(container: HTMLElement, trackData: TrackData) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    Object.assign(this.canvas.style, {
      position: 'absolute',
      left: '18px',
      bottom: '18px',
      borderRadius: '14px',
      background: 'rgba(15, 15, 35, 0.45)',
      pointerEvents: 'none',
    });
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Fit the track bounds inside the canvas, preserving aspect ratio.
    const b = trackData.minimapBounds;
    const spanX = Math.max(b.maxX - b.minX, 1e-6);
    const spanZ = Math.max(b.maxZ - b.minZ, 1e-6);
    this.scale = Math.min((SIZE - 2 * MARGIN) / spanX, (SIZE - 2 * MARGIN) / spanZ);
    this.offsetX = (SIZE - spanX * this.scale) / 2 - b.minX * this.scale;
    this.offsetY = (SIZE - spanZ * this.scale) / 2 - b.minZ * this.scale;

    // Pre-bake the outline path in canvas space.
    this.outlinePath = new Path2D();
    const pts = trackData.minimapOutline;
    for (let i = 0; i < pts.length; i++) {
      const x = this.toX(pts[i].x);
      const y = this.toY(pts[i].z);
      if (i === 0) this.outlinePath.moveTo(x, y);
      else this.outlinePath.lineTo(x, y);
    }
    this.outlinePath.closePath();

    // Finish line tick: perpendicular segment at checkpoint 0.
    const cp = trackData.checkpoints[0];
    const cx = this.toX(cp.position.x);
    const cy = this.toY(cp.position.z);
    // Lateral direction in canvas space (perpendicular to forward in XZ).
    const lx = cp.forward.z;
    const ly = -cp.forward.x;
    const half = 7;
    this.finish = {
      x1: cx - lx * half,
      y1: cy - ly * half,
      x2: cx + lx * half,
      y2: cy + ly * half,
    };
  }

  private toX(worldX: number): number {
    return worldX * this.scale + this.offsetX;
  }

  private toY(worldZ: number): number {
    return worldZ * this.scale + this.offsetY;
  }

  update(karts: KartState[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Track outline.
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(220, 220, 230, 0.85)';
    ctx.stroke(this.outlinePath);

    // Finish line.
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(this.finish.x1, this.finish.y1);
    ctx.lineTo(this.finish.x2, this.finish.y2);
    ctx.stroke();

    // Kart dots; the player is drawn last (on top) with a white ring.
    let player: KartState | null = null;
    for (const kart of karts) {
      if (kart.isPlayer) {
        player = kart;
        continue;
      }
      this.drawDot(ctx, kart, 4, false);
    }
    if (player) this.drawDot(ctx, player, 6, true);
  }

  private drawDot(
    ctx: CanvasRenderingContext2D,
    kart: KartState,
    radius: number,
    ring: boolean,
  ): void {
    const x = this.toX(kart.position.x);
    const y = this.toY(kart.position.z);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `#${kart.color.toString(16).padStart(6, '0')}`;
    ctx.fill();
    if (ring) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }
}
