import type { ItemType } from './items';

/**
 * Carte type -> payload de tous les événements du jeu.
 * HUD, audio et effets visuels s'abonnent ; la simulation publie.
 */
export interface GameEvents {
  'race:countdown': { value: number };
  'race:start': Record<string, never>;
  /** Nouveau tour franchi (lap = tour qui commence). */
  'race:lap': { kartId: number; lap: number };
  'race:finish': { kartId: number; rank: number; time: number };
  'race:allFinished': Record<string, never>;
  'item:roulette': { kartId: number };
  'item:awarded': { kartId: number; item: ItemType };
  'item:used': { kartId: number; item: ItemType };
  'kart:hit': { kartId: number; cause: ItemType | 'COLLISION' };
  /** level 1/2 = mini-turbo, 3 = champignon. */
  'kart:boost': { kartId: number; level: 1 | 2 | 3 };
  'kart:driftCharge': { kartId: number; level: 1 | 2 };
  'coin:collected': { kartId: number; total: number };
  'coin:lost': { kartId: number };
}

export type GameEventName = keyof GameEvents;
