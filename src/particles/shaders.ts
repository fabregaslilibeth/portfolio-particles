// Every shape is a target position for the same particles. The vertex shader
// places each target (portrait, globe, country and phone from attributes; the
// works/skills helix procedurally), then blends them with scroll-driven
// weights. The fragment shader draws each point as a dot.

export const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  // 0 → 1: the intro title renders the portrait, row by row from the top.
  uniform float uFormation;
  uniform vec3 uIntroName;   // name lettering: scale, x, y
  uniform vec3 uIntroRole;   // job title lettering: scale, x, y
  uniform vec2 uIntroStage;  // x: scattered → name, y: name → job title
  // x: portrait→globe, y: →country, z: →helix (works, skills), w: →phone
  uniform vec4 uMorph;

  // Per-shape placement: x = scale, yzw = offset (world units).
  uniform vec4 uPortrait;
  uniform vec2 uHead;        // yaw, pitch
  uniform vec2 uPortraitLook; // brightness, dot size — applied while the portrait shows
  // 0 facing the camera → up to config turnScatter when tilted. A photo has no
  // real depth, so a tilted face would look flat; it breaks apart instead.
  uniform float uHeadScatter;
  uniform vec4 uGlobe;
  uniform vec2 uGlobeRot;    // yaw, pitch
  uniform vec4 uCountry;
  uniform float uCountryYaw;
  uniform vec4 uHelix;       // length, radius, spin, slide along its axis
  uniform vec3 uHelixCenter;
  uniform vec3 uHelixAxis;   // yaw, roll, pitch — yaw π/2 points it at the camera
  uniform float uHelixTunnel; // 0 spring → 1 end-on vortex (enables depth fade)
  uniform vec4 uPhone;       // height, x, y, z
  uniform vec2 uPhoneTilt;   // yaw, pitch

  uniform float uTurbulence;
  uniform vec2 uPointer;     // NDC
  uniform float uPointerActive;  // cursor is over the page
  uniform float uPointerMotion;  // cursor is moving, 0..1
  uniform float uAspect;

  attribute vec3 aOrigin;
  attribute vec3 aName;      // name lettering: x, y, brightness (0 = stays scattered)
  attribute vec3 aRole;      // job title lettering, same layout
  attribute vec3 aGlobe;
  attribute vec3 aCountry;
  attribute vec4 aPhone;     // xyz: point on a 1-tall phone, w: brightness
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

  vec3 rotateZ(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
  }

  void main() {
    // Intro. While the page loads, scattered dots spiral in to spell the
    // name; the same letter dots then re-form as the job title; then the
    // title renders the portrait row by row, top first. The other dots stay
    // scattered as faint dust throughout.
    float isLetter = step(0.2, aName.z);
    float nameDelay = aSeed.y * 0.5;
    float nameT = clamp((uIntroStage.x - nameDelay) / (1.0 - nameDelay), 0.0, 1.0);
    float nameEase = (1.0 - pow(1.0 - nameT, 3.0)) * isLetter;
    vec3 scattered = rotateY(aOrigin, (1.0 - nameEase) * 1.8);
    vec3 name = vec3(aName.xy * uIntroName.x + uIntroName.yz, 0.0);
    // Letters break apart and regroup, bulging in depth mid-way.
    float roleDelay = aSeed.z * 0.35;
    float roleEase = smoothstep(roleDelay, roleDelay + 0.65, uIntroStage.y) * isLetter;
    vec3 role = vec3(aRole.xy * uIntroRole.x + uIntroRole.yz, 0.0);
    vec3 intro = mix(mix(scattered, name, nameEase), role, roleEase);
    intro.z += sin(roleEase * 3.14159265) * (aSeed.w - 0.5) * 0.6;
    float introLuma = mix(mix(0.2, aName.z, nameEase), aRole.z, roleEase);

    // Render: each row leaves the title a beat after the one above it.
    float delay = clamp(0.5 - position.y, 0.0, 1.0) * 0.62 + aSeed.x * 0.04;
    float t = clamp((uFormation - delay) / 0.34, 0.0, 1.0);
    float ease = 1.0 - pow(1.0 - t, 3.0);

    // Tilted, the portrait breaks apart like dust: most dots shift a little,
    // a few fly far, and they keep drifting — the flat photo never shows.
    vec3 scatterDir = normalize(aSeed.yzw - 0.5 + 0.0001);
    float reach = 0.12 + 0.88 * pow(fract(aSeed.x * 31.7), 2.0);
    float scatterAmount = uHeadScatter * reach * (0.85 + 0.15 * sin(uTime * 1.1 + aSeed.w * 20.0));
    vec3 portraitLocal = position + scatterDir * scatterAmount;
    vec3 portrait = rotateX(rotateY(portraitLocal, uHead.x), uHead.y) * uPortrait.x + uPortrait.yzw;

    vec3 g = rotateX(rotateY(aGlobe, uGlobeRot.x), uGlobeRot.y);
    vec3 globe = g * uGlobe.x + uGlobe.yzw;

    vec3 country = rotateY(aCountry, uCountryYaw) * uCountry.x + uCountry.yzw;

    // Works → skills: one double helix. Over Works it lies tilted across the
    // screen, spinning, and swings round in perspective into a spring; over
    // Skills it keeps turning until it points straight at the camera — the
    // vortex. Fast scrolling roughens the strands.
    float rough = 1.0 + uTurbulence * 4.0;
    float isRung = step(aSeed.z, 0.16);
    // Position along the helix 0 → 1; rungs sit at regular steps like base pairs.
    float along = mix(aExtra.x, (floor(aExtra.x * 40.0) + 0.5) / 40.0, isRung);
    float twist = along * 20.0 + uHelix.z + (aSeed.w - 0.5) * 0.12 * rough;
    vec2 spoke = vec2(cos(twist), sin(twist));
    float strand = step(0.5, aSeed.y) * 2.0 - 1.0;
    vec2 across = mix(spoke * strand, spoke * (fract(aSeed.y * 7.31) * 2.0 - 1.0), isRung);
    float helixRadius = uHelix.y * (0.92 + 0.16 * fract(aSeed.w * 13.7) * rough);
    // Axis along X (along = 0 at the -X end), strands circling in Y/Z.
    vec3 helixLocal = vec3((along - 0.5) * uHelix.x - uHelix.w, across * helixRadius);
    vec3 helix = rotateX(rotateZ(rotateY(helixLocal, uHelixAxis.x), uHelixAxis.y), uHelixAxis.z) + uHelixCenter;
    // As a tunnel: fade in at the near end and away into the distance, so the
    // vanishing point (behind the skills text) stays calm.
    float tunnelFade = smoothstep(0.0, 0.05, along) * mix(1.0, 0.15, smoothstep(0.1, 1.0, along));

    // Contact: the dots come to rest as a phone, tilting with the cursor.
    vec3 phone = rotateX(rotateY(aPhone.xyz, uPhoneTilt.x), uPhoneTilt.y) * uPhone.x + uPhone.yzw;

    vec3 shape = mix(portrait, globe, uMorph.x);
    shape = mix(shape, country, uMorph.y);
    shape = mix(shape, helix, uMorph.z);
    shape = mix(shape, phone, uMorph.w);

    float luma = mix(aLuma.x, aLuma.y, uMorph.x);
    luma = mix(luma, aLuma.z, uMorph.y);
    luma = mix(luma, mix(0.75 + 0.25 * aSeed.w, 0.55, isRung), uMorph.z);
    luma = mix(luma, aPhone.w, uMorph.w);
    luma = mix(introLuma, luma, ease);

    // How much each shape currently "owns" the particle.
    float wGlobe = uMorph.x * (1.0 - uMorph.y) * (1.0 - uMorph.z) * (1.0 - uMorph.w);
    float wHelix = uMorph.z * (1.0 - uMorph.w);
    // No depth test, so the far side of the globe shows through — dim it.
    float shapeAlpha = mix(1.0, mix(0.16, 1.0, smoothstep(-0.25, 0.45, g.z)), wGlobe);
    shapeAlpha *= mix(1.0, mix(1.0, tunnelFade, uHelixTunnel), wHelix);
    // A face needs more light, and finer dots, than an abstract shape.
    float wPortrait = 1.0 - uMorph.x;
    shapeAlpha *= mix(1.0, uPortraitLook.x, wPortrait * ease);
    // Rows light up while they fly from the title into the portrait.
    shapeAlpha *= 1.0 + 1.2 * 4.0 * t * (1.0 - t) * wPortrait;
    // The words should read as titles, not ghosts.
    shapeAlpha *= 1.0 + 0.9 * max(nameEase, roleEase) * (1.0 - ease);
    // Dots flung furthest fade a little, like dust settling out of the air.
    shapeAlpha *= 1.0 - 0.3 * clamp(scatterAmount * 5.0, 0.0, 1.0) * wPortrait;

    vec3 pos = mix(intro, shape, ease);
    pos.z += sin(uTime * 0.7 + aSeed.w * TAU) * 0.012 * ease;
    vec3 jitterDir = normalize(aSeed.xyz - 0.5 + 0.0001);
    pos += jitterDir * uTurbulence * 0.06 * sin(uTime * 6.0 + aSeed.w * 40.0);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vec4 clip = projectionMatrix * mv;

    // Cursor. Abstract shapes: nearby dots brighten, tint and lean away.
    // Portrait: a clean push would warp the features, so the dots under the
    // cursor scatter like disturbed sand instead, with no tint.
    vec2 toPointer = clip.xy / clip.w - uPointer;
    toPointer.x *= uAspect;
    // A tighter radius on the face, so the cursor brushes through it. Abstract
    // shapes react while hovered; the face only while the mouse moves, so it
    // settles back into focus when the cursor rests on it.
    float hover = smoothstep(mix(0.32, 0.24, wPortrait), 0.0, length(toPointer)) * ease;
    float near = hover * mix(uPointerActive, uPointerMotion, wPortrait);
    vec2 away = normalize(toPointer + 0.00001);
    vec2 lean = away * 0.03;
    vec2 dustDir = vec2(fract(aSeed.y * 13.1), fract(aSeed.z * 17.3)) * 2.0 - 1.0 + away * 0.6;
    vec2 dust = dustDir * (0.02 + 0.1 * pow(fract(aSeed.w * 7.7), 2.0)) * (0.8 + 0.2 * sin(uTime * 2.0 + aSeed.x * 30.0));
    clip.xy += mix(lean, dust, wPortrait) * vec2(1.0 / uAspect, 1.0) * near * clip.w;
    gl_Position = clip;

    float twinkle = 0.8 + 0.2 * sin(uTime * 1.3 + aSeed.w * 30.0);
    float nearCamera = smoothstep(0.25, 1.0, -mv.z);
    float hoverLight = 1.0 + near * mix(1.6, 0.2, wPortrait);
    vAlpha = (0.12 + 0.88 * luma) * twinkle * shapeAlpha * nearCamera * hoverLight;
    vGlow = near * (1.0 - wPortrait);

    // Loose scattered dots read a little larger; letter dots don't.
    float loose = (1.0 - ease) * (1.0 - max(nameEase, roleEase));
    float size = uSize * aExtra.y * (1.0 + loose * 0.6) * mix(1.0, uPortraitLook.y, wPortrait * ease);
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
    // Solid centre, soft rim: crisp enough for facial detail, no hard edges.
    float core = 1.0 - smoothstep(0.18, 0.5, d);
    vec3 color = mix(uColor, uAccent, vGlow * 0.8);
    gl_FragColor = vec4(color, min(core * vAlpha * uExposure, 1.0));
    #include <colorspace_fragment>
  }
`;
