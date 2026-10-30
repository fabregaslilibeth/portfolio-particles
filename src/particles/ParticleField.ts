import * as THREE from 'three';
import { vertexShader, fragmentShader } from './shaders';
import type { Shapes, TextShape } from './shapes';

export interface FieldOptions {
  color: string;
  accent: string;
  exposure: number;
  /** Brightness and dot-size multipliers while the portrait is showing. */
  portraitLook: [number, number];
  pointSize: number;
  maxPixelRatio: number;
}

/**
 * One THREE.Points cloud on a fixed full-screen canvas. It starts with just
 * the scattered dots and the intro words, so it can animate immediately;
 * the scroll shapes arrive later via `setShapes`.
 */
export class ParticleField {
  readonly uniforms = {
    uTime: { value: 0 },
    uSize: { value: 0 },
    uPixelRatio: { value: 1 },
    uFormation: { value: 0 },
    uIntroName: { value: new THREE.Vector3(1, 0, 0) },
    uIntroRole: { value: new THREE.Vector3(1, 0, 0) },
    uIntroStage: { value: new THREE.Vector2() },
    uMorph: { value: new THREE.Vector4() },
    uPortrait: { value: new THREE.Vector4(1, 0, 0, 0) },
    uHead: { value: new THREE.Vector2() },
    uPortraitLook: { value: new THREE.Vector2(1, 1) },
    uHeadScatter: { value: 0 },
    uGlobe: { value: new THREE.Vector4(1, 0, 0, 0) },
    uGlobeRot: { value: new THREE.Vector2() },
    uCountry: { value: new THREE.Vector4(1, 0, 0, 0) },
    uCountryYaw: { value: 0 },
    uHelix: { value: new THREE.Vector4(1, 0.1, 0, 0) },
    uHelixCenter: { value: new THREE.Vector3() },
    uHelixAxis: { value: new THREE.Vector3() },
    uHelixTunnel: { value: 0 },
    uPhone: { value: new THREE.Vector4(1, 0, 0, 0) },
    uPhoneTilt: { value: new THREE.Vector2() },
    uTurbulence: { value: 0 },
    uPointer: { value: new THREE.Vector2() },
    uPointerActive: { value: 0 },
    uPointerMotion: { value: 0 },
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
  private readonly count: number;

  constructor(
    private readonly container: HTMLElement,
    origin: Float32Array,
    intro: { name: TextShape; role: TextShape },
    private readonly options: FieldOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.camera.position.z = 3;
    this.uniforms.uColor.value.set(options.color);
    this.uniforms.uAccent.value.set(options.accent);
    this.uniforms.uExposure.value = options.exposure;
    this.uniforms.uPortraitLook.value.set(...options.portraitLook);

    const n = (this.count = origin.length / 3);
    const seed = new Float32Array(n * 4);
    const extra = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 4; c++) seed[i * 4 + c] = Math.random();
      extra[i * 2] = Math.random();
      // Mostly even dots (a face reads best that way) with a rare larger "star".
      extra[i * 2 + 1] = 0.6 + 0.25 * Math.random() + 1.1 * Math.pow(Math.random(), 8);
    }

    const g = this.geometry;
    g.setAttribute('aOrigin', new THREE.BufferAttribute(origin, 3));
    g.setAttribute('aName', new THREE.BufferAttribute(intro.name.points, 3));
    g.setAttribute('aRole', new THREE.BufferAttribute(intro.role.points, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2));
    // Filled in by setShapes once the heavy shapes are built.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aGlobe', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aCountry', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aPhone', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    g.setAttribute('aLuma', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
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

  /** Uploads the scroll shapes. */
  setShapes(shapes: Shapes): void {
    const n = this.count;
    const g = this.geometry;
    const write = (name: string, data: Float32Array) => {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      (attr.array as Float32Array).set(data);
      attr.needsUpdate = true;
    };

    const phone = new Float32Array(n * 4);
    const luma = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      phone[i * 4] = shapes.phone.positions[i * 3];
      phone[i * 4 + 1] = shapes.phone.positions[i * 3 + 1];
      phone[i * 4 + 2] = shapes.phone.positions[i * 3 + 2];
      phone[i * 4 + 3] = shapes.phone.luma[i];
      luma[i * 3] = shapes.portrait.luma[i];
      luma[i * 3 + 1] = shapes.globe.luma[i];
      luma[i * 3 + 2] = shapes.country.luma[i];
    }
    write('position', shapes.portrait.positions);
    write('aGlobe', shapes.globe.positions);
    write('aCountry', shapes.country.positions);
    write('aPhone', phone);
    write('aLuma', luma);
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

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
