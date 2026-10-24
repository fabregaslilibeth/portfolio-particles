// Every shape is a target position for the same particles. The vertex shader
// builds each target (portrait, globe and country from attributes; helix,
// tunnel and outline procedurally), then blends them with scroll-driven
// weights. The fragment shader draws each point as a soft round dot.

export const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uFormation;
  // x: portrait→globe, y: →country, z: →helix, w: →tunnel
  uniform vec4 uMorph;
  // →outline
  uniform float uMorph5;

  // Per-shape placement: x = scale, yzw = offset (world units).
  uniform vec4 uPortrait;
  uniform vec2 uHead;        // yaw, pitch
  uniform vec4 uGlobe;
  uniform vec2 uGlobeRot;    // yaw, pitch
  uniform vec4 uCountry;
  uniform float uCountryYaw;
  uniform vec4 uHelix;       // length, radius, y, slide (0..1)
  uniform vec2 uTunnel;      // radius, push
  uniform vec4 uOutline;     // left, right, top, bottom

  uniform float uTurbulence;
  uniform vec2 uPointer;     // NDC
  uniform float uPointerActive;
  uniform float uAspect;

  attribute vec3 aOrigin;
  attribute vec3 aGlobe;
  attribute vec3 aCountry;
  attribute vec3 aLuma;      // portrait, globe, country
  attribute vec4 aSeed;      // independent randoms
  attribute vec2 aExtra;     // x: position along paths, y: size

  varying float vAlpha;
  varying float vGlow;

  const float TAU = 6.28318530718;

  vec3 rotateY(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  }

  vec3 rotateX(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
  }

  void main() {
    // Intro: each particle starts on its own delay and spirals in.
    float delay = aSeed.x * 0.55;
    float t = clamp((uFormation - delay) / (1.0 - delay), 0.0, 1.0);
    float ease = 1.0 - pow(1.0 - t, 3.0);
    vec3 origin = rotateY(aOrigin, (1.0 - ease) * 1.8);

    vec3 portrait = rotateX(rotateY(position, uHead.x), uHead.y) * uPortrait.x + uPortrait.yzw;

    vec3 g = rotateX(rotateY(aGlobe, uGlobeRot.x), uGlobeRot.y);
    vec3 globe = g * uGlobe.x + uGlobe.yzw;

    vec3 country = rotateY(aCountry, uCountryYaw) * uCountry.x + uCountry.yzw;

    // Double helix along X. ~14% of particles become rungs between the two
    // strands; fast scrolling roughens the strands.
    float rough = 1.0 + uTurbulence * 4.0;
    float isRung = step(aSeed.z, 0.14);
    float along = mix(aExtra.x, (floor(aExtra.x * 30.0) + 0.5) / 30.0, isRung);
    float angle = along * 14.0 + uTime * 0.45 + uHelix.w * 3.0 + (aSeed.w - 0.5) * 0.15 * rough;
    vec2 ring = vec2(cos(angle), sin(angle));
    float strand = step(0.5, aSeed.y) * 2.0 - 1.0;
    vec2 section = mix(ring * strand, ring * (fract(aSeed.y * 7.31) * 2.0 - 1.0), isRung);
    float radius = uHelix.y * (0.88 + 0.24 * fract(aSeed.w * 13.7) * rough);
    vec3 helix = vec3(
      (along - 0.5 - uHelix.w * 0.3) * uHelix.x,
      section.x * radius + uHelix.z,
      section.y * radius
    );

    // Warp tunnel: particles stream toward the camera along a twisting tube.
    float flow = fract(aExtra.x + uTime * 0.05 + uTunnel.y);
    float depth = mix(-10.0, 2.0, flow);
    float tunnelAngle = aSeed.w * TAU + depth * 0.18 + uTime * 0.15;
    float tunnelRadius = uTunnel.x * (0.75 + 0.5 * aSeed.y);
    vec3 tunnel = vec3(cos(tunnelAngle) * tunnelRadius, sin(tunnelAngle) * tunnelRadius, depth);
    float tunnelFade = smoothstep(0.0, 0.12, flow) * smoothstep(1.0, 0.8, flow);

    // Outline: ~12% trace a slowly circulating frame around the contact
    // link; the rest fall back into a dim star field.
    float member = step(fract(aSeed.x * 17.3 + aSeed.z * 3.1), 0.12);
    float w = uOutline.y - uOutline.x;
    float h = uOutline.z - uOutline.w;
    float d = fract(aExtra.x + uTime * 0.012) * 2.0 * (w + h);
    vec2 edge;
    if (d < w) edge = vec2(uOutline.x + d, uOutline.z);
    else if (d < w + h) edge = vec2(uOutline.y, uOutline.z - (d - w));
    else if (d < 2.0 * w + h) edge = vec2(uOutline.y - (d - w - h), uOutline.w);
    else edge = vec2(uOutline.x, uOutline.w + (d - 2.0 * w - h));
    vec3 frame = vec3(edge + (vec2(aSeed.y, aSeed.w) - 0.5) * 0.02, (aSeed.z - 0.5) * 0.03);
    vec3 stars = aOrigin * 0.9 + vec3(0.0, 0.0, -2.5);
    vec3 outline = mix(stars, frame, member);

    vec3 shape = mix(portrait, globe, uMorph.x);
    shape = mix(shape, country, uMorph.y);
    shape = mix(shape, helix, uMorph.z);
    shape = mix(shape, tunnel, uMorph.w);
    shape = mix(shape, outline, uMorph5);

    float luma = mix(aLuma.x, aLuma.y, uMorph.x);
    luma = mix(luma, aLuma.z, uMorph.y);
    luma = mix(luma, 0.55 + 0.45 * aSeed.w, uMorph.z);
    luma = mix(luma, 0.95, uMorph.w);
    luma = mix(luma, mix(0.2, 0.95, member), uMorph5);

    // How much each shape currently "owns" the particle.
    float wGlobe = uMorph.x * (1.0 - uMorph.y) * (1.0 - uMorph.z) * (1.0 - uMorph.w) * (1.0 - uMorph5);
    float wTunnel = uMorph.w * (1.0 - uMorph5);
    // The far side of the globe shows through (no depth test) — dim it.
    float shapeAlpha = mix(1.0, mix(0.16, 1.0, smoothstep(-0.25, 0.45, g.z)), wGlobe);
    shapeAlpha *= mix(1.0, tunnelFade, wTunnel);

    vec3 pos = mix(origin, shape, ease);
    pos.z += sin(uTime * 0.7 + aSeed.w * TAU) * 0.012 * ease;
    vec3 jitterDir = normalize(aSeed.xyz - 0.5 + 0.0001);
    pos += jitterDir * uTurbulence * 0.06 * sin(uTime * 6.0 + aSeed.w * 40.0);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vec4 clip = projectionMatrix * mv;

    // Cursor: nearby dots brighten, tint and lean away slightly.
    vec2 toPointer = clip.xy / clip.w - uPointer;
    toPointer.x *= uAspect;
    float near = smoothstep(0.32, 0.0, length(toPointer)) * uPointerActive * ease;
    clip.xy += normalize(toPointer + 0.00001) * vec2(1.0 / uAspect, 1.0) * near * 0.03 * clip.w;
    gl_Position = clip;

    float twinkle = 0.8 + 0.2 * sin(uTime * 1.3 + aSeed.w * 30.0);
    float nearCamera = smoothstep(0.25, 1.0, -mv.z);
    vAlpha = (0.12 + 0.88 * luma) * twinkle * shapeAlpha * nearCamera * (1.0 + near * 1.6) * smoothstep(0.0, 0.15, t);
    vGlow = near;

    float size = uSize * aExtra.y * (1.0 + (1.0 - ease) * 0.6);
    gl_PointSize = min(size * uPixelRatio / max(-mv.z, 0.05), 40.0 * uPixelRatio);
  }
`;

export const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform float uExposure;

  varying float vAlpha;
  varying float vGlow;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    core *= core;
    vec3 color = mix(uColor, uAccent, vGlow * 0.8);
    gl_FragColor = vec4(color, min(core * vAlpha * uExposure, 1.0));
    #include <colorspace_fragment>
  }
`;
