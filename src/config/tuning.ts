/**
 * Toutes les constantes de gameplay. Seul fichier à modifier pour
 * l'équilibrage (vague 3). Unités : mètres, secondes, radians.
 */
export const TUNING = {
  sim: {
    /** Pas de simulation fixe. */
    dt: 1 / 60,
    /** Clamp anti-spirale de l'accumulateur. */
    maxFrameDelta: 0.25,
  },

  race: {
    totalLaps: 3,
    kartCount: 8,
    countdownStepDuration: 1.0,
    /** Délai avant l'écran de résultats après l'arrivée du joueur. */
    resultsDelay: 2.0,
  },

  kart: {
    radius: 1.2,
    /** Vitesse max de base sur route. */
    maxSpeed: 34,
    maxReverseSpeed: 10,
    accel: 22,
    brakeDecel: 40,
    /** Drag quadratique + roulement. */
    dragCoeff: 0.012,
    rollingResistance: 1.2,
    /** Friction latérale (exp(-grip*dt)) en adhérence / en drift. */
    gripNormal: 8,
    gripDrift: 2.5,
    /** Vitesse de rotation de base (rad/s) à steer = 1. */
    turnRate: 1.9,
    /** Facteur cloche : vitesse à laquelle le braquage est maximal. */
    turnSpeedPeak: 14,
    /** Multiplicateur de vitesse max hors-piste. */
    offroadSpeedMult: 0.5,
    /** Bonus de vitesse max par pièce. */
    coinSpeedBonus: 0.005,
    maxCoins: 10,
    /** Pièces perdues quand touché. */
    coinsLostOnHit: 3,
  },

  drift: {
    /** Conditions de déclenchement. */
    minSpeed: 12,
    minSteer: 0.3,
    hopDuration: 0.25,
    /** Taux de rotation en drift : base + blend * range, signé par direction. */
    baseTurnRate: 1.1,
    steerTurnRange: 1.6,
    /** Charge plus vite en drift serré. */
    tightChargeBonus: 0.5,
    /** Seuils mini-turbo (secondes de charge). */
    miniTurbo1Time: 1.0,
    miniTurbo2Time: 2.2,
    /** Durées de boost par niveau (1, 2) — index 0 inutilisé. */
    boostDurations: [0, 0.9, 1.5] as const,
  },

  boost: {
    speedMult: 1.35,
    accelMult: 2.0,
    mushroomDuration: 1.4,
    boostPadDuration: 1.0,
  },

  star: {
    duration: 7.5,
    speedMult: 1.2,
  },

  hit: {
    spinDuration: 1.0,
    /** Friction forte pendant le spin. */
    spinDecel: 25,
  },

  walls: {
    /** Largeur d'herbe carrossable au-delà de la route avant le mur. */
    offroadWidth: 10,
    /** Restitution latérale au contact du mur. */
    restitution: 0.4,
    /** Malus sur la vitesse avant au contact. */
    forwardSpeedKeep: 0.85,
  },

  items: {
    rouletteDuration: 1.6,
    itemBoxRespawn: 3.0,
    itemBoxRadius: 1.5,
    coinRadius: 1.0,
    projectileRadius: 0.8,
    greenShellSpeed: 42,
    greenShellMaxBounces: 4,
    greenShellLife: 8.0,
    redShellSpeed: 44,
    /** Distance de course sous laquelle la rouge passe en homing direct. */
    redShellHomingDistance: 18,
    /** Taux de virage max en homing (rad/s). */
    redShellTurnRate: 4.0,
    redShellLife: 12.0,
    bananaLife: 30.0,
    ownerImmunityTime: 0.5,
    /** Décalage de pose de la banane derrière le kart. */
    bananaDropDistance: 2.5,
  },

  ai: {
    /** Lookahead = base + speed * speedFactor. */
    lookaheadBase: 6,
    lookaheadSpeedFactor: 0.45,
    steerGain: 2.5,
    /** Offset latéral max par IA. */
    maxLateralOffset: 3,
    offsetChangeMin: 4,
    offsetChangeMax: 8,
    /** Rubber-banding : multiplicateur borné sur maxSpeed/accel. */
    rubberBandGain: 0.5,
    rubberBandMin: 0.92,
    rubberBandMax: 1.08,
    /** Distance max devant pour tirer une carapace rouge. */
    redShellRange: 40,
  },

  collisions: {
    kartRestitution: 0.3,
  },

  camera: {
    distance: 6.5,
    height: 3.0,
    lookAhead: 5,
    lookHeight: 1.2,
    /** Amortissement exp (1 - exp(-damp * dt)). */
    positionDamp: 8,
    fovNormal: 62,
    fovBoost: 74,
    fovDamp: 6,
    /** Rotation de la caméra vers l'extérieur du drift. */
    driftYawOffset: 0.18,
  },

  respawn: {
    /** Tombé sous le sol de plus de cette marge -> respawn. */
    belowGroundMargin: 2,
    /** Distance aberrante à la ligne centrale -> respawn. */
    maxLateralDistance: 60,
  },
} as const;

export type Tuning = typeof TUNING;
