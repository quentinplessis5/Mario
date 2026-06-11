import * as THREE from 'three';
import type { ItemType } from './items';

export type SurfaceType = 'ROAD' | 'OFFROAD' | 'BOOST_PAD';

/** -1 = gauche, 1 = droite, 0 = pas de drift */
export type DriftDirection = -1 | 0 | 1;

export interface DriftState {
  active: boolean;
  /** Figé au déclenchement du drift. */
  direction: DriftDirection;
  /** Secondes de charge accumulées pendant le drift. */
  chargeTime: number;
  /** Dérivé de chargeTime via les seuils de tuning. */
  miniTurboLevel: 0 | 1 | 2;
  /** Petit saut visuel au déclenchement (décroît vers 0). */
  hopTimer: number;
}

export interface KartInput {
  /** -1..1 (négatif = marche arrière / frein) */
  throttle: number;
  /** -1..1 (négatif = gauche) */
  steer: number;
  /** Bouton drift maintenu. */
  drift: boolean;
  /** Bouton objet (front montant géré par ItemSystem). */
  useItem: boolean;
}

export interface KartState {
  /** 0 = joueur */
  id: number;
  isPlayer: boolean;
  name: string;
  /** Couleur hex de la palette du kart. */
  color: number;

  // --- Transform & dynamique (simulation ; le rendu interpole prev -> curr) ---
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  /** Yaw en radians. forward = (sin(heading), 0, cos(heading)) */
  heading: number;
  prevHeading: number;
  velocity: THREE.Vector3;
  /** Vitesse avant signée (scalaire dérivé, mis à jour par la physique). */
  speed: number;
  /** Angle visuel de glisse en drift (rendu uniquement). */
  visualSlip: number;

  grounded: boolean;
  surface: SurfaceType;
  /** Dernière distance curviligne connue sur la spline (hint pour closestPoint). */
  splineHint: number;

  drift: DriftState;
  /** > 0 : vitesse max et accélération augmentées. */
  boostTimer: number;
  /** > 0 : touché (toupie), pas de contrôle. */
  spinTimer: number;
  /** > 0 : invincible + plus rapide. */
  starTimer: number;

  /** 0..10, bonus de vitesse max. */
  coins: number;
  heldItem: ItemType | null;
  /** > 0 : roulette d'objet en cours. */
  rouletteTimer: number;

  // --- Progression (écrit par ProgressTracker UNIQUEMENT) ---
  /** 1..totalLaps */
  lap: number;
  nextCheckpoint: number;
  /** Métrique monotone pour le classement. */
  progress: number;
  /** 1..8 */
  rank: number;
  finished: boolean;
  finishTime: number;
}

/** Crée un KartState neutre prêt à être placé sur la grille. */
export function createKartState(
  id: number,
  isPlayer: boolean,
  name: string,
  color: number,
): KartState {
  return {
    id,
    isPlayer,
    name,
    color,
    position: new THREE.Vector3(),
    prevPosition: new THREE.Vector3(),
    heading: 0,
    prevHeading: 0,
    velocity: new THREE.Vector3(),
    speed: 0,
    visualSlip: 0,
    grounded: true,
    surface: 'ROAD',
    splineHint: 0,
    drift: {
      active: false,
      direction: 0,
      chargeTime: 0,
      miniTurboLevel: 0,
      hopTimer: 0,
    },
    boostTimer: 0,
    spinTimer: 0,
    starTimer: 0,
    coins: 0,
    heldItem: null,
    rouletteTimer: 0,
    lap: 1,
    nextCheckpoint: 0,
    progress: 0,
    rank: id + 1,
    finished: false,
    finishTime: 0,
  };
}
