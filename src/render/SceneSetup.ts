import * as THREE from 'three';
import { TUNING } from '../config/tuning';

/** Sky gradient: world-space direction from camera, blended bottom -> top. */
const SKY_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTopColor;
uniform vec3 uHorizonColor;
varying vec3 vWorldPos;
void main() {
  float h = normalize(vWorldPos - cameraPosition).y;
  float t = pow(clamp(h, 0.0, 1.0), 0.55);
  gl_FragColor = vec4(mix(uHorizonColor, uTopColor, t), 1.0);
}
`;

/**
 * Owns the WebGL renderer, the scene and the main perspective camera.
 * No dynamic shadows: lighting is a single directional + hemisphere fill,
 * fake blob shadows are handled by the kart visuals themselves.
 */
export class SceneSetup {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;

  private readonly sky: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Explicitly no dynamic shadows (fake blob shadows instead).
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();

    // Light fog matching the sky horizon color for depth cueing.
    const horizonColor = new THREE.Color(0xcfe9ff);
    this.scene.fog = new THREE.Fog(horizonColor, 150, 1000);

    this.camera = new THREE.PerspectiveCamera(
      TUNING.camera.fovNormal,
      window.innerWidth / window.innerHeight,
      0.1,
      1500,
    );
    this.camera.position.set(0, 4, -8);

    // Inverted sphere with a vertical blue gradient (not affected by fog).
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uTopColor: { value: new THREE.Color(0x3f8fe8) },
        uHorizonColor: { value: horizonColor },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 24, 12), skyMat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // Key light (sun) + hemisphere fill for a soft saturated toon look.
    const sun = new THREE.DirectionalLight(0xfff3df, 2.4);
    sun.position.set(60, 100, 40);
    this.scene.add(sun);

    const hemi = new THREE.HemisphereLight(0xbfdfff, 0x9c8a66, 1.1);
    this.scene.add(hemi);

    window.addEventListener('resize', this.onResize);
  }

  /** Renders one frame; keeps the sky dome centered on the camera. */
  render(): void {
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
