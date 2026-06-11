import * as THREE from 'three';
import {
  ItemType,
  type PickupState,
  type ProjectileState,
  type ProjectileType,
} from '../types/items';
import type { KartInput, KartState } from '../types/kart';
import type { ITrackQuery } from '../types/track';
import type { EventBus } from '../core/EventBus';
import { TUNING } from '../config/tuning';
import { rollItem } from './ItemTables';
import { applyHit, useItem } from './ItemEffects';
import { ProjectileManager } from './Projectiles';

const ITEMS = TUNING.items;

/**
 * Single facade of the items module. Owns the roulette, item usage,
 * projectile simulation and ALL item-related collision detection and
 * resolution (projectile-kart, kart-pickup, projectile-projectile).
 * Physics only handles kart-kart.
 */
export class ItemSystem {
  /** Live arrays, mutated in place — read by rendering and AI. */
  readonly projectiles: ProjectileState[];
  readonly pickups: PickupState[] = [];

  private readonly bus: EventBus;
  private readonly manager: ProjectileManager;
  /** Previous useItem button state per kart (rising-edge detection). */
  private prevUseItem: boolean[] = [];

  /** Bound spawner handed to ItemEffects.useItem. */
  private readonly spawnProjectile = (
    type: ProjectileType,
    owner: KartState,
    karts: KartState[],
  ): void => {
    this.manager.spawn(type, owner, karts);
  };

  constructor(bus: EventBus, track: ITrackQuery) {
    this.bus = bus;
    this.manager = new ProjectileManager(track);
    this.projectiles = this.manager.projectiles;
  }

  /** Creates the pickup states from the track layout (positions are cloned). */
  init(itemBoxPositions: THREE.Vector3[], coinPositions: THREE.Vector3[]): void {
    this.pickups.length = 0;
    let id = 0;
    for (const pos of itemBoxPositions) {
      this.pickups.push({
        id: id++,
        kind: 'ITEM_BOX',
        position: pos.clone(),
        active: true,
        respawnTimer: 0,
      });
    }
    for (const pos of coinPositions) {
      this.pickups.push({
        id: id++,
        kind: 'COIN',
        position: pos.clone(),
        active: true,
        respawnTimer: 0,
      });
    }
  }

  /** Clears projectiles and reactivates every pickup (race restart). */
  reset(): void {
    this.manager.clear();
    for (const p of this.pickups) {
      p.active = true;
      p.respawnTimer = 0;
    }
    this.prevUseItem.length = 0;
  }

  /** One fixed simulation step (dt = TUNING.sim.dt). */
  update(karts: KartState[], inputs: KartInput[], dt: number): void {
    this.updateRoulettes(karts, dt);
    this.updateItemUsage(karts, inputs);
    this.manager.update(karts, dt);
    this.updatePickups(karts, dt);
    this.resolveProjectileKart(karts);
    this.resolveProjectileProjectile();
    this.manager.purgeDead();
  }

  // --- a. Roulette ---------------------------------------------------------

  private updateRoulettes(karts: KartState[], dt: number): void {
    for (const kart of karts) {
      if (kart.rouletteTimer <= 0) continue;
      kart.rouletteTimer -= dt;
      if (kart.rouletteTimer <= 0) {
        kart.rouletteTimer = 0;
        const item = rollItem(kart.rank);
        kart.heldItem = item;
        this.bus.emit('item:awarded', { kartId: kart.id, item });
      }
    }
  }

  // --- b. Usage (rising edge of useItem) -----------------------------------

  private updateItemUsage(karts: KartState[], inputs: KartInput[]): void {
    for (let i = 0; i < karts.length; i++) {
      const kart = karts[i];
      const pressed = i < inputs.length && inputs[i].useItem;
      const rising = pressed && !this.prevUseItem[i];
      this.prevUseItem[i] = pressed;

      if (!rising) continue;
      if (kart.heldItem === null || kart.rouletteTimer > 0 || kart.spinTimer > 0) continue;

      const item = kart.heldItem;
      useItem(kart, karts, this.spawnProjectile, this.bus);
      kart.heldItem = null;
      this.bus.emit('item:used', { kartId: kart.id, item });
    }
  }

  // --- d. Kart-pickup collisions + item box respawn -------------------------

  private updatePickups(karts: KartState[], dt: number): void {
    for (const pickup of this.pickups) {
      if (!pickup.active) {
        // Coins do not respawn during the race; boxes do.
        if (pickup.kind === 'ITEM_BOX' && pickup.respawnTimer > 0) {
          pickup.respawnTimer -= dt;
          if (pickup.respawnTimer <= 0) {
            pickup.respawnTimer = 0;
            pickup.active = true;
          }
        }
        continue;
      }

      const pickupRadius =
        pickup.kind === 'ITEM_BOX' ? ITEMS.itemBoxRadius : ITEMS.coinRadius;
      const reach = TUNING.kart.radius + pickupRadius;
      const reachSq = reach * reach;

      for (const kart of karts) {
        if (kart.finished) continue;
        if (kart.position.distanceToSquared(pickup.position) >= reachSq) continue;

        if (pickup.kind === 'ITEM_BOX') {
          // Only consumed when the kart can actually start a roulette.
          if (kart.heldItem !== null || kart.rouletteTimer > 0) continue;
          kart.rouletteTimer = ITEMS.rouletteDuration;
          this.bus.emit('item:roulette', { kartId: kart.id });
          pickup.active = false;
          pickup.respawnTimer = ITEMS.itemBoxRespawn;
        } else {
          kart.coins = Math.min(kart.coins + 1, TUNING.kart.maxCoins);
          pickup.active = false;
          this.bus.emit('coin:collected', { kartId: kart.id, total: kart.coins });
        }
        break; // Pickup consumed: stop testing other karts.
      }
    }
  }

  // --- e. Projectile-kart collisions ----------------------------------------

  private resolveProjectileKart(karts: KartState[]): void {
    const reach = ITEMS.projectileRadius + TUNING.kart.radius;
    const reachSq = reach * reach;

    for (const proj of this.projectiles) {
      if (!proj.alive) continue;
      for (const kart of karts) {
        if (kart.finished) continue;
        if (kart.id === proj.ownerId && proj.ownerImmunity > 0) continue;
        if (proj.position.distanceToSquared(kart.position) >= reachSq) continue;

        if (kart.starTimer > 0) {
          // Star: the projectile is destroyed, the kart is untouched.
          proj.alive = false;
        } else {
          applyHit(kart, proj.type, this.bus);
          proj.alive = false;
          this.bus.emit('kart:hit', { kartId: kart.id, cause: proj.type });
        }
        break;
      }
    }
  }

  // --- f. Projectile-projectile collisions ----------------------------------

  private resolveProjectileProjectile(): void {
    const reach = ITEMS.projectileRadius * 2;
    const reachSq = reach * reach;
    const list = this.projectiles;

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        // At least one shell must be involved (bananas never collide together).
        if (a.type === ItemType.BANANA && b.type === ItemType.BANANA) continue;
        if (a.position.distanceToSquared(b.position) >= reachSq) continue;
        a.alive = false;
        b.alive = false;
        break;
      }
    }
  }
}
