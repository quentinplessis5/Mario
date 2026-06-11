import * as THREE from 'three';
import { ItemType, type ProjectileState, type ProjectileType } from '../types/items';
import type { KartState } from '../types/kart';
import type { ITrackQuery } from '../types/track';
import { TUNING } from '../config/tuning';
import { angleDiff, clamp, damp, mod } from '../core/MathUtils';

const ITEMS = TUNING.items;

/**
 * Creation + per-tick simulation of all projectiles (shells, bananas).
 * ItemSystem owns the orchestration and the collision resolution; this
 * manager only moves projectiles and tracks their lifetime.
 */
export class ProjectileManager {
  /** Live array, mutated in place (splice on purge) — safe to alias. */
  readonly projectiles: ProjectileState[] = [];

  private readonly track: ITrackQuery;
  private nextId = 1;
  /** Red shells that switched to the direct-homing phase (sticky). */
  private readonly homingIds = new Set<number>();

  constructor(track: ITrackQuery) {
    this.track = track;
  }

  /** Removes everything (race restart). */
  clear(): void {
    this.projectiles.length = 0;
    this.homingIds.clear();
    this.nextId = 1;
  }

  /** Spawns a projectile from the shooter kart. */
  spawn(type: ProjectileType, owner: KartState, karts: KartState[]): void {
    const fwdX = Math.sin(owner.heading);
    const fwdZ = Math.cos(owner.heading);

    const p: ProjectileState = {
      id: this.nextId++,
      type,
      ownerId: owner.id,
      ownerImmunity: ITEMS.ownerImmunityTime,
      position: owner.position.clone(),
      prevPosition: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      splineHint: owner.splineHint,
      targetKartId: null,
      bounces: 0,
      lifeTimer: 0,
      alive: true,
      isStatic: false,
    };
    p.position.y += 0.5;

    switch (type) {
      case ItemType.GREEN_SHELL:
        p.velocity.set(fwdX * ITEMS.greenShellSpeed, 0, fwdZ * ITEMS.greenShellSpeed);
        p.lifeTimer = ITEMS.greenShellLife;
        break;

      case ItemType.RED_SHELL: {
        const target = findRedShellTarget(owner, karts);
        p.targetKartId = target ? target.id : null;
        // Fires forward; with no target it behaves exactly like a green shell.
        const speed = target ? ITEMS.redShellSpeed : ITEMS.greenShellSpeed;
        p.velocity.set(fwdX * speed, 0, fwdZ * speed);
        p.lifeTimer = target ? ITEMS.redShellLife : ITEMS.greenShellLife;
        break;
      }

      case ItemType.BANANA: {
        // Dropped behind the kart, snapped to the ground once (static).
        p.position.x -= fwdX * ITEMS.bananaDropDistance;
        p.position.z -= fwdZ * ITEMS.bananaDropDistance;
        const cp = this.track.closestPoint(p.position, p.splineHint);
        p.splineHint = cp.distance;
        p.position.y = this.track.groundHeightAt(cp) + 0.3;
        p.isStatic = true;
        p.lifeTimer = ITEMS.bananaLife;
        break;
      }
    }

    p.prevPosition.copy(p.position);
    this.projectiles.push(p);
  }

  /** Advances every live projectile by one fixed step. */
  update(karts: KartState[], dt: number): void {
    for (const p of this.projectiles) {
      if (!p.alive) continue;

      p.prevPosition.copy(p.position);

      p.lifeTimer -= dt;
      if (p.lifeTimer <= 0) {
        p.alive = false;
        continue;
      }
      if (p.ownerImmunity > 0) p.ownerImmunity -= dt;

      if (p.isStatic) continue; // Banana: nothing else to do.

      if (p.type === ItemType.RED_SHELL && p.targetKartId !== null) {
        const target = findKartById(karts, p.targetKartId);
        if (target && !target.finished) {
          this.updateRedShell(p, target, dt);
          continue;
        }
        // Target gone or finished: fall back to green-shell behaviour.
        p.targetKartId = null;
        this.homingIds.delete(p.id);
      }

      this.updateBallistic(p, dt);
    }
  }

  /** Removes dead projectiles in place (backwards splice). */
  purgeDead(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (!this.projectiles[i].alive) {
        this.homingIds.delete(this.projectiles[i].id);
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** Green shell (and untargeted red): straight motion + wall bounces. */
  private updateBallistic(p: ProjectileState, dt: number): void {
    p.position.addScaledVector(p.velocity, dt);

    const cp = this.track.closestPoint(p.position, p.splineHint);
    p.splineHint = cp.distance;
    p.position.y = this.track.groundHeightAt(cp) + 0.4;

    const limit = this.track.wallLimitAt(cp);
    if (Math.abs(cp.lateralOffset) > limit) {
      // Reflect velocity on the lateral normal: v -= 2 * dot(v, right) * right.
      const d = p.velocity.dot(cp.right);
      p.velocity.addScaledVector(cp.right, -2 * d);
      // Reproject onto the wall limit, keeping the ground-glued height.
      const y = p.position.y;
      const side = cp.lateralOffset >= 0 ? 1 : -1;
      p.position.copy(cp.position).addScaledVector(cp.right, side * limit);
      p.position.y = y;
      p.bounces++;
      if (p.bounces > ITEMS.greenShellMaxBounces) p.alive = false;
    }
  }

  /** Red shell: spline-follow phase, then direct homing when close. */
  private updateRedShell(p: ProjectileState, target: KartState, dt: number): void {
    const track = this.track;
    const speed = ITEMS.redShellSpeed;
    const length = track.totalLength;

    if (this.homingIds.has(p.id)) {
      // --- Homing phase: steer the velocity toward the target. ---
      const desired = Math.atan2(
        target.position.x - p.position.x,
        target.position.z - p.position.z,
      );
      const current = Math.atan2(p.velocity.x, p.velocity.z);
      const maxTurn = ITEMS.redShellTurnRate * dt;
      const h = current + clamp(angleDiff(desired, current), -maxTurn, maxTurn);
      p.velocity.set(Math.sin(h) * speed, 0, Math.cos(h) * speed);
      p.position.addScaledVector(p.velocity, dt);

      const cp = track.closestPoint(p.position, p.splineHint);
      p.splineHint = cp.distance;
      p.position.y = track.groundHeightAt(cp) + 0.4;
      // Keep it on the road (no bounce, just clamp to the wall limit).
      const limit = track.wallLimitAt(cp);
      if (Math.abs(cp.lateralOffset) > limit) {
        const y = p.position.y;
        const side = cp.lateralOffset >= 0 ? 1 : -1;
        p.position.copy(cp.position).addScaledVector(cp.right, side * limit);
        p.position.y = y;
      }
      return;
    }

    // --- Spline-follow phase. ---
    // Read scalar data first: ClosestPointResult objects may be reused by the
    // track implementation between calls.
    const selfCp = track.closestPoint(p.position, p.splineHint);
    const selfLateral = selfCp.lateralOffset;
    const selfDist = selfCp.distance;

    const targetCp = track.closestPoint(target.position, target.splineHint);
    const targetLateral = targetCp.lateralOffset;
    const targetDist = targetCp.distance;

    p.splineHint = selfDist + speed * dt;
    const sample = track.sampleAtDistance(p.splineHint);

    // Damped lateral tracking of the target's current lateral offset.
    const lateral = damp(selfLateral, targetLateral, 3, dt);
    p.position.copy(sample.position).addScaledVector(sample.right, lateral);
    p.position.y = sample.position.y + 0.4;
    p.velocity.copy(sample.forward).multiplyScalar(speed);

    // Race distance to the target (curvilinear, modulo track length).
    const ahead = mod(targetDist - mod(p.splineHint, length), length);
    if (Math.min(ahead, length - ahead) < ITEMS.redShellHomingDistance) {
      this.homingIds.add(p.id);
    }
  }
}

/** Linear scan by id (8 karts: cheaper than a map). */
function findKartById(karts: KartState[], id: number): KartState | null {
  for (const k of karts) if (k.id === id) return k;
  return null;
}

/**
 * Red shell target: the non-finished kart ahead of the shooter that is
 * closest in progress (i.e. the kart ranked just above). Null if the
 * shooter leads.
 */
function findRedShellTarget(owner: KartState, karts: KartState[]): KartState | null {
  let best: KartState | null = null;
  let bestGap = Infinity;
  for (const k of karts) {
    if (k.id === owner.id || k.finished) continue;
    const gap = k.progress - owner.progress;
    if (gap > 0 && gap < bestGap) {
      bestGap = gap;
      best = k;
    }
  }
  return best;
}
