import * as THREE from 'three';
import type { KartState } from '../types/kart';
import { EventBus } from '../core/EventBus';
import { randRange } from '../core/MathUtils';

/** Interpolated kart transform produced by RenderSync. */
interface VisualTransform {
  position: THREE.Vector3;
  heading: number;
}

interface Particle {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
}

/** Burst requests queued from events, resolved to positions in update(). */
interface PendingBurst {
  kind: 'boost' | 'coin' | 'hit';
  kartId: number;
  level?: 1 | 2 | 3;
}

/** Hard particle budget (pool size), well under the 500 limit. */
const POOL_SIZE = 320;

/** Mini-turbo spark colors per charge level: pale yellow, blue, orange. */
const SPARK_COLORS: readonly number[] = [0xfff0a0, 0x46a6ff, 0xff8c28];

/** Boost ring colors per boost level (1/2 mini-turbo, 3 mushroom). */
const BOOST_COLORS: Record<1 | 2 | 3, number> = {
  1: 0x46a6ff,
  2: 0xff8c28,
  3: 0xff4a3c,
};

/** Soft radial white dot, tinted per-sprite through material.color. */
function makeParticleTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Lightweight pooled sprite particle system for gameplay feedback:
 * - drift sparks at the rear wheels (color follows the mini-turbo level)
 * - boost flame trail while boostTimer > 0
 * - bursts on 'kart:boost', 'coin:collected' and 'kart:hit' events
 */
export class Effects {
  private readonly particles: Particle[] = [];
  private readonly free: number[] = [];
  private readonly pending: PendingBurst[] = [];

  /** Per-kart fractional emission accumulators (id -> count). */
  private readonly sparkAccum = new Map<number, number>();
  private readonly trailAccum = new Map<number, number>();

  // Scratch vectors (no per-frame allocations).
  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly spawnPos = new THREE.Vector3();
  private readonly spawnVel = new THREE.Vector3();

  constructor(scene: THREE.Scene, bus: EventBus) {
    const texture = makeParticleTexture();

    // Pre-allocate the whole pool; sprites stay in the scene, hidden.
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      scene.add(sprite);
      this.particles.push({
        sprite,
        material,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        gravity: 0,
      });
      this.free.push(i);
    }

    // Events only carry kart ids: queue them, resolve positions in update().
    bus.on('kart:boost', (p) => {
      this.pending.push({ kind: 'boost', kartId: p.kartId, level: p.level });
    });
    bus.on('coin:collected', (p) => {
      this.pending.push({ kind: 'coin', kartId: p.kartId });
    });
    bus.on('kart:hit', (p) => {
      this.pending.push({ kind: 'hit', kartId: p.kartId });
    });
  }

  update(
    karts: KartState[],
    getVisual: (id: number) => VisualTransform,
    frameDt: number,
  ): void {
    // 1) Resolve queued event bursts at the kart's interpolated position.
    for (const burst of this.pending) {
      const visual = getVisual(burst.kartId);
      if (burst.kind === 'boost') {
        this.burstBoost(visual, burst.level ?? 1);
      } else if (burst.kind === 'coin') {
        this.burstCoin(visual);
      } else {
        this.burstHit(visual);
      }
    }
    this.pending.length = 0;

    // 2) Continuous emitters.
    for (const kart of karts) {
      const visual = getVisual(kart.id);
      this.fwd.set(Math.sin(visual.heading), 0, Math.cos(visual.heading));
      this.side.set(Math.cos(visual.heading), 0, -Math.sin(visual.heading));

      // Drift sparks at the rear wheels (after the hop has landed).
      if (kart.drift.active && kart.drift.hopTimer <= 0 && kart.grounded) {
        const color = SPARK_COLORS[kart.drift.miniTurboLevel];
        let accum = (this.sparkAccum.get(kart.id) ?? 0) + 36 * frameDt;
        while (accum >= 1) {
          accum -= 1;
          const lateral = Math.random() < 0.5 ? 0.65 : -0.65;
          this.spawnPos
            .copy(visual.position)
            .addScaledVector(this.fwd, -0.8)
            .addScaledVector(this.side, lateral);
          this.spawnPos.y += 0.12;
          this.spawnVel
            .copy(this.side)
            .multiplyScalar(lateral * randRange(1.0, 2.4))
            .addScaledVector(this.fwd, randRange(-2.5, -1.0));
          this.spawnVel.y = randRange(0.8, 2.0);
          this.spawn(this.spawnPos, this.spawnVel, color, randRange(0.2, 0.4), 0.28, 7);
        }
        this.sparkAccum.set(kart.id, accum);
      } else {
        this.sparkAccum.set(kart.id, 0);
      }

      // Boost flame trail at the rear of the kart.
      if (kart.boostTimer > 0) {
        let accum = (this.trailAccum.get(kart.id) ?? 0) + 45 * frameDt;
        while (accum >= 1) {
          accum -= 1;
          this.spawnPos
            .copy(visual.position)
            .addScaledVector(this.fwd, -1.1)
            .addScaledVector(this.side, randRange(-0.3, 0.3));
          this.spawnPos.y += randRange(0.2, 0.5);
          this.spawnVel.copy(this.fwd).multiplyScalar(randRange(-6, -3));
          this.spawnVel.y = randRange(0.2, 1.2);
          const color = Math.random() < 0.4 ? 0xfff2b0 : 0xff8c28;
          this.spawn(this.spawnPos, this.spawnVel, color, randRange(0.2, 0.35), 0.4, 1.5);
        }
        this.trailAccum.set(kart.id, accum);
      } else {
        this.trailAccum.set(kart.id, 0);
      }
    }

    // 3) Integrate live particles (light gravity, fade + shrink out).
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      p.life -= frameDt;
      if (p.life <= 0) {
        p.life = 0;
        p.sprite.visible = false;
        this.free.push(i);
        continue;
      }
      p.velocity.y -= p.gravity * frameDt;
      p.sprite.position.addScaledVector(p.velocity, frameDt);
      const t = p.life / p.maxLife;
      p.material.opacity = t;
      const s = p.size * (0.4 + 0.6 * t);
      p.sprite.scale.set(s, s, 1);
    }
  }

  // ----------------------------------------------------------------- bursts

  /** Horizontal ring flash when a boost fires (mini-turbo / mushroom). */
  private burstBoost(visual: VisualTransform, level: 1 | 2 | 3): void {
    const color = BOOST_COLORS[level];
    const count = 14;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.spawnPos.copy(visual.position);
      this.spawnPos.y += 0.35;
      this.spawnVel.set(Math.cos(a), 0.15, Math.sin(a)).multiplyScalar(randRange(4, 6));
      this.spawn(this.spawnPos, this.spawnVel, color, randRange(0.3, 0.45), 0.45, 4);
    }
  }

  /** Small golden sparkle fountain on coin pickup. */
  private burstCoin(visual: VisualTransform): void {
    for (let i = 0; i < 9; i++) {
      this.spawnPos.copy(visual.position);
      this.spawnPos.y += 0.8;
      this.spawnVel.set(randRange(-1.5, 1.5), randRange(2.5, 4.5), randRange(-1.5, 1.5));
      this.spawn(this.spawnPos, this.spawnVel, 0xffd24a, randRange(0.3, 0.5), 0.3, 8);
    }
  }

  /** Grey/red debris splash on impact. */
  private burstHit(visual: VisualTransform): void {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawnPos.copy(visual.position);
      this.spawnPos.y += 0.5;
      this.spawnVel
        .set(Math.cos(a), 0, Math.sin(a))
        .multiplyScalar(randRange(2, 5));
      this.spawnVel.y = randRange(2, 4.5);
      const color = Math.random() < 0.5 ? 0xd8d8d8 : 0xff6a4a;
      this.spawn(this.spawnPos, this.spawnVel, color, randRange(0.35, 0.55), 0.35, 9);
    }
  }

  // ------------------------------------------------------------------- pool

  private spawn(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    color: number,
    life: number,
    size: number,
    gravity: number,
  ): void {
    const index = this.free.pop();
    if (index === undefined) return; // budget exhausted: silently skip
    const p = this.particles[index];
    p.sprite.position.copy(position);
    p.velocity.copy(velocity);
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.gravity = gravity;
    p.material.color.setHex(color);
    p.material.opacity = 1;
    p.sprite.scale.set(size, size, 1);
    p.sprite.visible = true;
  }
}
