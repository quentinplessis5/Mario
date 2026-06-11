import * as THREE from 'three';

export enum ItemType {
  MUSHROOM = 'MUSHROOM',
  GREEN_SHELL = 'GREEN_SHELL',
  RED_SHELL = 'RED_SHELL',
  BANANA = 'BANANA',
  STAR = 'STAR',
  COIN = 'COIN',
}

export type ProjectileType =
  | ItemType.GREEN_SHELL
  | ItemType.RED_SHELL
  | ItemType.BANANA;

export interface ProjectileState {
  id: number;
  type: ProjectileType;
  ownerId: number;
  /** Temps restant pendant lequel le propriétaire est ignoré par les collisions. */
  ownerImmunity: number;
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Distance curviligne (hint closestPoint + suivi de spline carapace rouge). */
  splineHint: number;
  /** Carapace rouge uniquement. */
  targetKartId: number | null;
  /** Carapace verte : détruite après N rebonds. */
  bounces: number;
  /** Durée de vie restante en secondes. */
  lifeTimer: number;
  alive: boolean;
  /** Banane posée. */
  isStatic: boolean;
}

export interface PickupState {
  id: number;
  kind: 'ITEM_BOX' | 'COIN';
  position: THREE.Vector3;
  active: boolean;
  /** Item box : > 0 pendant le respawn. */
  respawnTimer: number;
}
