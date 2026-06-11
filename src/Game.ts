import * as THREE from 'three';
import { GameLoop } from './core/GameLoop';
import { Input } from './core/Input';
import { EventBus } from './core/EventBus';
import { TUNING } from './config/tuning';
import { createRaceState, type RaceState } from './types/race';
import type { KartState } from './types/kart';

/**
 * Orchestrateur : ordre d'init et ordre d'update par tick.
 *
 * Ordre d'update par tick (contrat, vague 3) :
 *   1. Input.poll() / AIDriver -> KartInput[]
 *   2. ItemSystem.update(dt)        (roulette, déclenchements)
 *   3. KartPhysics.stepAll(...)     (drift inclus)
 *   4. Projectiles.update(dt)
 *   5. Collisions.resolve(...)
 *   6. ProgressTracker.update()     (checkpoints, laps, ranks)
 *   7. RaceManager.update(dt)       (phases, fins de course)
 *
 * APIs attendues des modules de la vague 2 (contrat gelé) :
 *   track:   buildTrack(): TrackData
 *   physics: KartPhysics(trackQuery, bus) .stepAll(karts, inputs, dt)
 *            Collisions(bus) .resolve(karts, projectiles, pickups, dt)
 *   render:  SceneSetup(canvas) ; KartVisualFactory ; ItemVisualFactory ;
 *            FollowCamera(camera) .update(kartVisualState, frameDt) ;
 *            Effects(scene, bus) ; RenderSync(scene) .sync(karts, projectiles, pickups, alpha)
 *   items:   ItemSystem(bus, trackQuery) .update(karts, inputs, race, dt)
 *            (gère roulette/attribution/usage, possède Projectiles & Pickups)
 *   ai:      AIDriver(trackQuery, tuning) .computeInput(kart, karts, projectiles, race, dt): KartInput
 *   race:    ProgressTracker(trackData, bus) .update(karts, raceState)
 *            RaceManager(bus) .update(raceState, karts, dt)
 *   hud:     Hud(bus) .update(raceState, playerKart) ; Screens(bus) ; Minimap(trackData)
 *   audio:   AudioSystem(bus) .resume() .update(playerKart, frameDt)
 */
export class Game {
  readonly bus = new EventBus();
  readonly input = new Input();
  readonly raceState: RaceState;
  readonly karts: KartState[] = [];

  private loop: GameLoop;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  constructor(canvas: HTMLCanvasElement) {
    this.raceState = createRaceState(TUNING.race.totalLaps, TUNING.race.kartCount);

    // --- Placeholder vague 1 : scène vide qui tourne ---
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6ec6ff);
    this.camera = new THREE.PerspectiveCamera(
      TUNING.camera.fovNormal,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 5, 12);
    this.camera.lookAt(0, 0, 0);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.loop = new GameLoop(
      (dt) => this.simulate(dt),
      (alpha, frameDt) => this.render(alpha, frameDt),
    );
  }

  start(): void {
    this.loop.start();
  }

  private simulate(_dt: number): void {
    // Vague 3 : ordre d'update documenté ci-dessus.
  }

  private render(_alpha: number, _frameDt: number): void {
    this.renderer.render(this.scene, this.camera);
  }
}
