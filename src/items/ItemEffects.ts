import { ItemType, type ProjectileType } from '../types/items';
import type { KartState } from '../types/kart';
import type { EventBus } from '../core/EventBus';
import { TUNING } from '../config/tuning';

/** Callback used by ItemEffects to delegate projectile creation to Projectiles. */
export type SpawnProjectileFn = (
  type: ProjectileType,
  owner: KartState,
  karts: KartState[],
) => void;

/**
 * Applies the effect of the kart's held item. The caller (ItemSystem) is
 * responsible for clearing heldItem and emitting 'item:used'.
 */
export function useItem(
  kart: KartState,
  karts: KartState[],
  spawnProjectile: SpawnProjectileFn,
  bus: EventBus,
): void {
  switch (kart.heldItem) {
    case ItemType.MUSHROOM:
      kart.boostTimer = Math.max(kart.boostTimer, TUNING.boost.mushroomDuration);
      bus.emit('kart:boost', { kartId: kart.id, level: 3 });
      break;

    case ItemType.STAR:
      kart.starTimer = TUNING.star.duration;
      break;

    case ItemType.COIN:
      // Instant +2 coins, clamped to the cap.
      kart.coins = Math.min(kart.coins + 2, TUNING.kart.maxCoins);
      bus.emit('coin:collected', { kartId: kart.id, total: kart.coins });
      break;

    case ItemType.GREEN_SHELL:
    case ItemType.RED_SHELL:
    case ItemType.BANANA:
      spawnProjectile(kart.heldItem, kart, karts);
      break;

    case null:
      break;
  }
}

/**
 * Resolves a hit on a kart (projectile or hazard). Star makes the kart
 * immune. Physics reads spinTimer and handles control/drift cut itself.
 */
export function applyHit(
  kart: KartState,
  cause: ItemType | 'COLLISION',
  bus: EventBus,
): void {
  void cause;
  if (kart.starTimer > 0) return;

  kart.spinTimer = TUNING.hit.spinDuration;

  const lost = Math.min(kart.coins, TUNING.kart.coinsLostOnHit);
  if (lost > 0) {
    kart.coins -= lost;
    bus.emit('coin:lost', { kartId: kart.id });
  }
}
