import { ItemType } from '../types/items';
import { clamp } from '../core/MathUtils';

/**
 * Rank-weighted item distribution, Mario Kart style.
 * - Leaders (1-3): mostly defensive/weak items (banana, green shell, coin).
 * - Midfield (4-6): red shells and mushrooms.
 * - Tail (7-8): mushrooms and stars, never a banana.
 * COIN as a held item is only allowed for ranks 1-3 (+2 coins on use).
 */
type WeightedRow = ReadonlyArray<readonly [ItemType, number]>;

const TABLE: ReadonlyArray<WeightedRow> = [
  // Rank 1
  [
    [ItemType.BANANA, 30],
    [ItemType.GREEN_SHELL, 35],
    [ItemType.COIN, 25],
    [ItemType.MUSHROOM, 10],
  ],
  // Rank 2
  [
    [ItemType.BANANA, 20],
    [ItemType.GREEN_SHELL, 30],
    [ItemType.COIN, 15],
    [ItemType.RED_SHELL, 20],
    [ItemType.MUSHROOM, 15],
  ],
  // Rank 3
  [
    [ItemType.BANANA, 15],
    [ItemType.GREEN_SHELL, 25],
    [ItemType.COIN, 10],
    [ItemType.RED_SHELL, 30],
    [ItemType.MUSHROOM, 20],
  ],
  // Rank 4
  [
    [ItemType.GREEN_SHELL, 15],
    [ItemType.RED_SHELL, 35],
    [ItemType.MUSHROOM, 35],
    [ItemType.BANANA, 10],
    [ItemType.STAR, 5],
  ],
  // Rank 5
  [
    [ItemType.GREEN_SHELL, 10],
    [ItemType.RED_SHELL, 35],
    [ItemType.MUSHROOM, 40],
    [ItemType.BANANA, 5],
    [ItemType.STAR, 10],
  ],
  // Rank 6 (no banana from here on)
  [
    [ItemType.GREEN_SHELL, 10],
    [ItemType.RED_SHELL, 30],
    [ItemType.MUSHROOM, 45],
    [ItemType.STAR, 15],
  ],
  // Rank 7
  [
    [ItemType.RED_SHELL, 20],
    [ItemType.MUSHROOM, 50],
    [ItemType.STAR, 30],
  ],
  // Rank 8
  [
    [ItemType.RED_SHELL, 15],
    [ItemType.MUSHROOM, 45],
    [ItemType.STAR, 40],
  ],
];

/** Weighted random draw from the table matching the given rank (clamped to 1..8). */
export function rollItem(rank: number): ItemType {
  const row = TABLE[clamp(Math.floor(rank), 1, TABLE.length) - 1];
  let total = 0;
  for (const [, w] of row) total += w;
  let r = Math.random() * total;
  for (const [item, w] of row) {
    r -= w;
    if (r < 0) return item;
  }
  // Numerical fallback: last entry.
  return row[row.length - 1][0];
}
