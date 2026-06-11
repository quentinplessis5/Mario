import * as THREE from 'three';
import type { SurfaceType } from './kart';

export interface SplineSample {
  /** Point sur la ligne centrale (avec élévation). */
  position: THREE.Vector3;
  /** Tangente normalisée, sens de course. */
  forward: THREE.Vector3;
  /** Normale latérale normalisée (vers la droite du sens de course). */
  right: THREE.Vector3;
  /** Abscisse curviligne dans [0, totalLength). */
  distance: number;
  /** Demi-largeur de la route à cet endroit. */
  roadHalfWidth: number;
}

export interface ClosestPointResult extends SplineSample {
  /** Offset latéral signé du point requêté (négatif = gauche). */
  lateralOffset: number;
}

/**
 * LE contrat central de la piste : physique, IA, objets, classement et
 * mini-carte ne dépendent que de cette interface.
 */
export interface ITrackQuery {
  readonly totalLength: number;
  /** d est pris modulo totalLength (valeurs négatives acceptées). */
  sampleAtDistance(d: number): SplineSample;
  /**
   * Point le plus proche sur la ligne centrale, recherche locale autour de
   * hint (une distance curviligne). Fallback global si hint aberrant.
   */
  closestPoint(p: THREE.Vector3, hint: number): ClosestPointResult;
  /** Hauteur analytique du sol au point requêté. */
  groundHeightAt(result: ClosestPointResult): number;
  surfaceAt(result: ClosestPointResult): SurfaceType;
  /** |lateralOffset| maximal avant le mur invisible. */
  wallLimitAt(result: ClosestPointResult): number;
}

export interface Checkpoint {
  index: number;
  /** Centre de la porte. */
  position: THREE.Vector3;
  /** Normale du plan de la porte, orientée dans le sens de course. */
  forward: THREE.Vector3;
  /** Borne latérale de validation (anti-triche). */
  halfWidth: number;
  /** Abscisse curviligne de la porte. */
  splineDistance: number;
}

export interface SpawnPoint {
  position: THREE.Vector3;
  heading: number;
}

export interface TrackData {
  query: ITrackQuery;
  /** checkpoints[0] = ligne d'arrivée. */
  checkpoints: Checkpoint[];
  /** 8 positions, grille 2 colonnes derrière la ligne. */
  spawnPoints: SpawnPoint[];
  itemBoxPositions: THREE.Vector3[];
  coinPositions: THREE.Vector3[];
  /** Tous les meshes de la piste + décor (ajouté à la scène tel quel). */
  visualRoot: THREE.Group;
  /** Ligne centrale échantillonnée pour la mini-carte. */
  minimapOutline: { x: number; z: number }[];
  minimapBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}
