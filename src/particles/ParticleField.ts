import * as THREE from 'three';
import { vertexShader, fragmentShader } from './shaders';
import type { Shapes } from './shapes';

export interface FieldOptions {
  color: string;
  accent: string;
  exposure: number;
  pointSize: number;
  maxPixelRatio: number;
}

/** One THREE.Points cloud on a fixed full-screen canvas. */
export class ParticleField {
  readonly uniforms = {
    uTime: { value: 0 },
    uSize: { value: 0 },
    uPixelRatio: { value: 1 },
    uFormation: { value: 0 },
    uMorph: { value: new THREE.Vector4() },
    uMorph5: { value: 0 },
    uPortrait: { value: new THREE.Vector4(1, 0, 0, 0) },
    uHead: { value: new THREE.Vector2() },
    uGlobe: { value: new THREE.Vector4(1, 0, 0, 0) },
    uGlobeRot: { value: new THREE.Vector2() },
    uCountry: { value: new THREE.Vector4(1, 0, 0, 0) },
    uCountryYaw: { value: 0 },
    uHelix: { value: new THREE.Vector4(1, 0.1, 0, 0) },
    uTunnel: { value: new THREE.Vector2(1, 0) },
    uOutline: { value: new THREE.Vector4(-0.5, 0.5, 0.2, -0.2) },
    uTurbulence: { value: 0 },
    uPointer: { value: new THREE.Vector2() },
    uPointerActive: { value: 0 },
    uAspect: { value: 1 },
    uColor: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uExposure: { value: 1 },
  };

  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  /** Size of the z = 0 plane in world units, updated on resize. */
  readonly view = { width: 1, height: 1 };

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;

  constructor(private readonly container: HTMLElement, shapes: Shapes, private readonly options: FieldOptions) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.camera.position.z = 3;
    this.uniforms.uColor.value.set(options.color);
    this.uniforms.uAccent.value.set(options.accent);
    this.uniforms.uExposure.value = options.exposure;

    const n = shapes.count;
    const seed = new Float32Array(n * 4);
    const extra = new Float32Array(n * 2);
    const luma = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 4; c++) seed[i * 4 + c] = Math.random();
      extra[i * 2] = Math.random();
      // Mostly small dots with the occasional larger "star".
      extra[i * 2 + 1] = 0.55 + 0.35 * Math.random() + 1.2 * Math.pow(Math.random(), 4);
      luma[i * 3] = shapes.portrait.luma[i];
      luma[i * 3 + 1] = shapes.globe.luma[i];
      luma[i * 3 + 2] = shapes.country.luma[i];
    }

    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(shapes.portrait.positions, 3));
    g.setAttribute('aOrigin', new THREE.BufferAttribute(shapes.origin, 3));
    g.setAttribute('aGlobe', new THREE.BufferAttribute(shapes.globe.positions, 3));
    g.setAttribute('aCountry', new THREE.BufferAttribute(shapes.country.positions, 3));
    g.setAttribute('aLuma', new THREE.BufferAttribute(luma, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2));
    // Shapes move far outside the base positions; never cull the cloud.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(g, this.material);
    points.frustumCulled = false;
    this.scene.add(points);
    this.resize();
  }

  resize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio, this.options.maxPixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.view.height = 2 * this.camera.position.z * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.view.width = this.view.height * this.camera.aspect;

    this.uniforms.uPixelRatio.value = ratio;
    this.uniforms.uAspect.value = this.camera.aspect;
    // Slightly larger dots on big screens so density reads the same.
    this.uniforms.uSize.value = this.options.pointSize * THREE.MathUtils.clamp(height / 900, 0.8, 1.3);
  }

  /** Converts a viewport rectangle (CSS px) to world units on the z = 0 plane. */
  rectToWorld(rect: DOMRect, pad: number): THREE.Vector4 {
    const { innerWidth: vw, innerHeight: vh } = window;
    const { width: W, height: H } = this.view;
    return new THREE.Vector4(
      ((rect.left - pad) / vw - 0.5) * W,
      ((rect.right + pad) / vw - 0.5) * W,
      (0.5 - (rect.top - pad) / vh) * H,
      (0.5 - (rect.bottom + pad) / vh) * H,
    );
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
