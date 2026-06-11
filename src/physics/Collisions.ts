import type { KartState } from '../types/kart';
import { EventBus } from '../core/EventBus';
import { TUNING } from '../config/tuning';

/**
 * Kart-vs-kart collisions only (items, pickups and walls live elsewhere).
 * Brute force over all pairs (28 for 8 karts) on the XZ plane; karts are
 * circles of radius TUNING.kart.radius. Finished karts still collide.
 */
export class Collisions {
  constructor(private readonly bus: EventBus) {}

  resolveKarts(karts: KartState[]): void {
    const minDist = TUNING.kart.radius * 2;
    const minDistSq = minDist * minDist;

    for (let i = 0; i < karts.length; i++) {
      for (let j = i + 1; j < karts.length; j++) {
        const a = karts[i];
        const b = karts[j];

        let dx = b.position.x - a.position.x;
        let dz = b.position.z - a.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq >= minDistSq) continue;

        // Normal from a to b; arbitrary axis if perfectly overlapping.
        let dist = Math.sqrt(distSq);
        if (dist < 1e-6) {
          dist = 1e-6;
          dx = 1;
          dz = 0;
        }
        const nx = dx / dist;
        const nz = dz / dist;

        // Positional separation, half each along the normal.
        const push = (minDist - dist) / 2;
        a.position.x -= nx * push;
        a.position.z -= nz * push;
        b.position.x += nx * push;
        b.position.z += nz * push;

        // Impulse: equal masses exchange their normal velocity components,
        // scaled by restitution. Only applied when approaching, so resting
        // contacts do not jitter.
        const va = a.velocity.x * nx + a.velocity.z * nz;
        const vb = b.velocity.x * nx + b.velocity.z * nz;
        if (va - vb > 0) {
          const e = TUNING.collisions.kartRestitution;
          const mean = (va + vb) / 2;
          const half = (va - vb) / 2;
          const newVa = mean - e * half;
          const newVb = mean + e * half;
          a.velocity.x += (newVa - va) * nx;
          a.velocity.z += (newVa - va) * nz;
          b.velocity.x += (newVb - vb) * nx;
          b.velocity.z += (newVb - vb) * nz;
        }

        // Star power: a starred kart spins out a non-starred one.
        if (a.starTimer > 0 && b.starTimer <= 0) this.spinOut(b);
        else if (b.starTimer > 0 && a.starTimer <= 0) this.spinOut(a);
      }
    }
  }

  /** Applies the star-contact hit: spin, coin loss, events. */
  private spinOut(kart: KartState): void {
    // Already spinning: contact persists across ticks, do not re-trigger.
    if (kart.spinTimer > 0) return;
    kart.spinTimer = TUNING.hit.spinDuration;
    const coinsBefore = kart.coins;
    kart.coins = Math.max(0, kart.coins - TUNING.kart.coinsLostOnHit);
    this.bus.emit('kart:hit', { kartId: kart.id, cause: 'COLLISION' });
    if (kart.coins < coinsBefore) {
      this.bus.emit('coin:lost', { kartId: kart.id });
    }
  }
}
