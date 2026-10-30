import 'lenis/dist/lenis.css';
import './style.css';
import Lenis from 'lenis';
import { config } from './config';
import { buildShapes, scatter, textShape, type Shapes } from './particles/shapes';
import { ParticleField } from './particles/ParticleField';
import { createCursor } from './effects/cursor';
import { attachDissolve } from './effects/dissolve';
import { setupReveals } from './effects/reveal';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = matchMedia('(pointer: coarse)').matches;
/** `?skip-intro` jumps straight to the formed portrait — handy while designing. */
const skipIntro = reducedMotion || new URLSearchParams(location.search).has('skip-intro');

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const smooth = (v: number) => v * v * (3 - 2 * v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (current: number, target: number, seconds: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-dt / seconds));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const rad = (deg: number) => (deg * Math.PI) / 180;

function el<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

async function boot(): Promise<void> {
  // Always start at the top, scroll locked, so the intro plays in view.
  if (!skipIntro) {
    history.scrollRestoration = 'manual';
    scrollTo(0, 0);
    document.documentElement.classList.add('is-loading');
  }
  const count = Math.round(config.count * (coarsePointer ? config.mobileRatio : 1));

  // The particles start right away with just the intro words (cheap): the
  // name (VITE_NAME) and job title (VITE_ROLE). The heavy scroll shapes build
  // in the background and arrive later.
  const container = el('[data-field]');
  const narrowAtLoad = innerWidth < 820 || innerWidth / innerHeight < 0.9;
  const name = await textShape(count, container.dataset.name || document.title, narrowAtLoad);
  const role = await textShape(count, container.dataset.role || '', narrowAtLoad);
  const field = new ParticleField(container, scatter(count), { name, role }, {
    color: config.color,
    accent: config.accent,
    exposure: config.exposure,
    portraitLook: config.portrait.src ? [config.portrait.brightness, config.portrait.dotSize] : [1, 1],
    pointSize: config.pointSize,
    maxPixelRatio: coarsePointer ? 1.5 : 2,
  });
  const u = field.uniforms;

  let shapes: Shapes | null = null;
  let loadProgress = 0;
  void buildShapes(count, (done) => (loadProgress = done)).then((built) => {
    shapes = built;
    field.setShapes(built);
    applyLayout();
  });

  const lenis = reducedMotion ? null : new Lenis({ lerp: 0.085, anchors: true });
  if (!skipIntro) lenis?.stop();
  const cursor = coarsePointer ? null : createCursor(el('[data-cursor]'));
  if (!coarsePointer && !reducedMotion) document.querySelectorAll<HTMLElement>('[data-dissolve]').forEach(attachDissolve);
  setupReveals(document.querySelectorAll<HTMLElement>('.statement'));

  const sections = {
    hero: el('#hero'),
    globe: el('#globe'),
    country: el('#country'),
    works: el('#works'),
    skills: el('#skills'),
    contact: el('#contact'),
  };
  const track = el('[data-works]');
  const workItems = Array.from(track.children) as HTMLElement[];
  const workIndex = el('[data-work-index]');
  const workBar = el('[data-work-progress]');
  el('[data-work-total]').textContent = String(workItems.length).padStart(2, '0');

  // Layout: where each shape sits for the current viewport.
  const layout = {
    narrow: false,
    portrait: { scale: 1, x: 0, y: 0 },
    globe: { radius: 1, x: 0, y: 0 },
    country: { scale: 1, x: 0, y: 0 },
    helix: { springLength: 1, springRadius: 0.1, tunnelRadius: 1 },
    phone: { height: 1, x: 0, y: 0 },
    // Works strip (CSS px): where it starts, how far it travels, tile centres.
    strip: { start: 0, travel: 0, centres: [] as number[] },
  };
  const applyLayout = () => {
    field.resize();
    const { width: W, height: H } = field.view;
    const narrow = innerWidth < 820 || W / H < 0.9;
    layout.narrow = narrow;

    // Intro words: centred, about two-thirds of the screen wide. Each is
    // capped in height so a short word doesn't balloon.
    const wordWidth = narrow ? W * 0.82 : Math.min(W * 0.62, H * 1.6);
    const wordHeight = (aspect: number) => Math.min(wordWidth / aspect, H * (narrow ? 0.22 : 0.3));
    u.uIntroName.value.set(wordHeight(name.aspect), 0, 0);
    u.uIntroRole.value.set(wordHeight(role.aspect), 0, 0);

    // Portrait: anchored to the bottom edge, as tall as fits.
    let pScale = H * (narrow ? 0.7 : 0.88);
    // On phones the shoulders may run off the sides so the face stays large.
    pScale = Math.min(pScale, (W * (narrow ? 1.45 : 0.9)) / (shapes?.portraitAspect ?? 0.9));
    layout.portrait = { scale: pScale, x: 0, y: -H / 2 + pScale / 2 };

    layout.globe = narrow
      ? { radius: Math.min(W * 0.38, H * 0.22), x: 0, y: H * 0.18 }
      : { radius: H * 0.3, x: W * 0.2, y: 0 };

    const cScale = narrow ? H * 0.5 : H * 0.82;
    layout.country = narrow ? { scale: cScale, x: 0, y: H * 0.14 } : { scale: cScale, x: W * 0.2, y: 0 };

    // Helix: a spring longer than the screen is wide over Works; as the
    // Skills vortex its near rings sweep in from beyond the screen edges.
    layout.helix = {
      springLength: Math.max(W, H * 0.9) * 1.3,
      springRadius: H * (narrow ? 0.09 : 0.11),
      tunnelRadius: Math.max(W, H) * (narrow ? 0.34 : 0.28),
    };

    // Works strip: starts with its first tile in the right half of the screen
    // and ends with its last tile's right edge at the centre. The section is
    // exactly tall enough for that travel to map 1:1 onto scrolling.
    track.style.transform = 'none';
    const naturalLeft = track.getBoundingClientRect().left;
    layout.strip = {
      start: innerWidth * 0.5 - naturalLeft,
      travel: track.scrollWidth,
      centres: workItems.map((item) => item.offsetLeft + item.offsetWidth / 2),
    };
    sections.works.style.height = `${innerHeight + layout.strip.travel}px`;

    // Contact phone: right of the text on desktop, above it on phones.
    layout.phone = narrow ? { height: H * 0.42, x: 0, y: H * 0.2 } : { height: H * 0.72, x: W * 0.22, y: -H * 0.01 };
  };
  applyLayout();
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(applyLayout, 100);
  });

  // Pointer, in NDC, smoothed. `motion` builds up while the mouse moves and
  // drains once it stops; `moving` is its smoothed 0..1 version.
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, active: 0, inside: 0, seen: false, motion: 0, moving: 0 };
  if (!coarsePointer && !reducedMotion) {
    window.addEventListener('pointermove', (e) => {
      const x = (e.clientX / innerWidth) * 2 - 1;
      const y = -((e.clientY / innerHeight) * 2 - 1);
      // The browser also reports where the mouse already is (on load, after
      // scrolling) — only real travel counts as motion.
      if (pointer.seen) {
        pointer.motion += Math.hypot(x - pointer.tx, y - pointer.ty);
      } else {
        pointer.x = x;
        pointer.y = y;
        pointer.seen = true;
      }
      pointer.tx = x;
      pointer.ty = y;
      pointer.inside = 1;
    });
    document.addEventListener('pointerleave', () => (pointer.inside = 0));
  }

  // Intro phases: the name assembles while loading → its dots re-form as the
  // job title → the title renders the portrait → done (scroll unlocks).
  const intro = { phase: skipIntro ? 'done' : 'name', clock: 0, name: 0, nameDoneAt: -1, role: 0 };
  let formation = skipIntro ? 1 : 0;
  const startPhase = (phase: string) => {
    intro.phase = phase;
    intro.clock = 0;
  };
  let time = 0;
  let turbulence = 0;
  let lastScroll = scrollY;
  let activeWork = -1;
  let helixSpin = 0;
  let last = performance.now();

  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    lenis?.raf(now);
    time += dt * (reducedMotion ? 0.25 : 1);

    // --- read layout ---
    const vh = innerHeight;
    const top = (s: HTMLElement) => s.getBoundingClientRect().top;
    // 0 → 1 as a section's top travels from the bottom of the screen to near the top.
    const enter = (s: HTMLElement) => smooth(clamp01((vh * 0.95 - top(s)) / (vh * 0.8)));
    // 0 → 1 across a tall section's sticky scroll distance.
    const through = (s: HTMLElement) => {
      const r = s.getBoundingClientRect();
      return clamp01(-r.top / Math.max(r.height - vh, 1));
    };
    const recede = clamp01(-top(sections.hero) / vh);
    const m1 = enter(sections.globe);
    const m2 = enter(sections.country);
    const m3 = enter(sections.works);
    const m5 = enter(sections.contact);
    const workProgress = through(sections.works);
    // Spring → vortex: the helix turns end-on as Skills arrives, finishing
    // as its sticky content pins.
    const turn = smooth(clamp01((vh - top(sections.skills)) / vh));
    // The globe turns to face the country before morphing into it.
    const focus = smooth(clamp01((vh * 1.5 - top(sections.country)) / (vh * 0.6)));

    // --- inputs ---
    const velocity = lenis ? Math.abs(lenis.velocity) : Math.abs(scrollY - lastScroll);
    lastScroll = scrollY;
    turbulence = damp(turbulence, reducedMotion ? 0 : clamp01(velocity / 70), 0.15, dt);
    pointer.x = damp(pointer.x, pointer.tx, 0.35, dt);
    pointer.y = damp(pointer.y, pointer.ty, 0.35, dt);
    pointer.active = damp(pointer.active, pointer.inside, pointer.inside ? 0.3 : 0.8, dt);
    // Rises quickly with movement; about a second after the mouse stops it
    // falls back to 0 — that's when the portrait reassembles.
    pointer.motion *= Math.exp(-dt / 0.3);
    const movingTarget = clamp01(pointer.motion * 6) * pointer.inside;
    pointer.moving = damp(pointer.moving, movingTarget, movingTarget > pointer.moving ? 0.12 : 0.45, dt);

    // --- intro ---
    intro.clock += dt;
    if (intro.phase === 'name') {
      // The name assembles in step with loading — never ahead of it, and
      // never in under ~1.4s — then holds for a moment once complete.
      const target = Math.min(loadProgress, intro.clock / 1.4);
      intro.name = Math.min(target, intro.name + dt / 0.9);
      if (intro.name >= 1 && shapes && intro.nameDoneAt < 0) intro.nameDoneAt = intro.clock;
      if (intro.nameDoneAt >= 0 && intro.clock - intro.nameDoneAt > 0.8) startPhase('role');
    } else if (intro.phase === 'role') {
      // Re-form as the job title, then hold it long enough to read.
      intro.role = Math.min(1, intro.clock / 1.1);
      if (intro.clock > 2.2) {
        startPhase('render');
        document.documentElement.classList.remove('is-loading');
        document.documentElement.classList.add('is-ready');
        lenis?.start();
      }
    } else if (intro.phase === 'render') {
      formation = Math.min(1, intro.clock / config.formationSeconds);
      if (formation >= 1) startPhase('done');
    }

    // --- uniforms ---
    u.uTime.value = time;
    u.uFormation.value = formation;
    u.uIntroStage.value.set(intro.name, intro.role);
    u.uMorph.value.set(m1, m2, m3, m5);
    u.uTurbulence.value = turbulence;
    u.uPointer.value.set(pointer.x, pointer.y);
    u.uPointerActive.value = pointer.active;
    u.uPointerMotion.value = pointer.moving;

    const p = layout.portrait;
    u.uPortrait.value.set(p.scale * (1 - 0.1 * recede), p.x, p.y, -0.7 * recede);
    // At rest the portrait faces the camera, crisp. Moving the mouse turns
    // the head toward it and scatters the dots; stop, and both settle back.
    // Scrolling down into the intro turns and scatters it too.
    const tiltYaw = pointer.x * 0.32 * pointer.moving - recede * 0.35;
    const tiltPitch = -pointer.y * 0.12 * pointer.moving;
    u.uHead.value.set(tiltYaw, tiltPitch);
    // Further off-centre scatters more (a bigger turn would look flatter).
    // Pitch counts double: a face has even less depth top-to-bottom.
    const offCentre = clamp01(Math.hypot(pointer.x * 0.32, pointer.y * 0.24) / 0.3);
    const stir = Math.max(pointer.moving * (0.55 + 0.45 * offCentre), clamp01(recede * 1.2));
    u.uHeadScatter.value = config.portrait.turnScatter * stir * (2 - stir);

    const g = layout.globe;
    u.uGlobe.value.set(g.radius, g.x, g.y, 0);
    const spin = wrapAngle(time * 0.16 - 0.6);
    const [focusLon, focusLat] = shapes?.countryFocus ?? [0, 0];
    const yaw = spin + wrapAngle(-rad(focusLon) - spin) * focus;
    u.uGlobeRot.value.set(yaw, 0.32 + (rad(focusLat) - 0.32) * focus);

    const c = layout.country;
    u.uCountry.value.set(c.scale, c.x, c.y, 0);
    u.uCountryYaw.value = Math.sin(time * 0.35) * 0.16 + pointer.x * 0.2 * pointer.active;

    // Helix. Over Works: tilted across the screen, spinning, growing and
    // swinging round so it reads as a spring in perspective. Over Skills: it
    // keeps turning until it points straight at the camera — the vortex.
    const hx = layout.helix;
    const skillsRect = sections.skills.getBoundingClientRect();
    const skillsScroll = clamp01((vh - skillsRect.top) / (vh + skillsRect.height));
    const grow = 1 + 0.35 * workProgress;
    const springLength = hx.springLength * grow;
    const springYaw = 0.12 + 0.33 * workProgress;
    const tunnelLength = 10; // near end at z = +1, far end deep at z = -9
    // Accumulated, so changing speed never makes the spin jump.
    helixSpin += dt * mix(0.6, 0.25, turn);
    u.uHelix.value.set(
      mix(springLength, tunnelLength, turn),
      mix(hx.springRadius * grow, hx.tunnelRadius, turn),
      helixSpin + workProgress * 2.4 + skillsScroll * 4,
      mix(workProgress * springLength * 0.12, 0, turn),
    );
    u.uHelixCenter.value.set(0, 0, mix(0, 1 - tunnelLength / 2, turn));
    u.uHelixAxis.value.set(
      mix(springYaw, Math.PI / 2, turn) + pointer.x * 0.1 * pointer.active,
      mix(0.35, 0, turn),
      mix(0.08, 0, turn) - pointer.y * 0.08 * pointer.active,
    );
    u.uHelixTunnel.value = turn;

    // Contact phone: angled slightly toward the text, floating gently and
    // tilting with the cursor (a phone really is flat, so it can turn freely).
    const ph = layout.phone;
    const bob = Math.sin(time * 0.9) * 0.012 * ph.height;
    u.uPhone.value.set(ph.height, ph.x, ph.y + bob, 0);
    u.uPhoneTilt.value.set(
      (layout.narrow ? 0 : -0.2) + pointer.x * 0.28 * pointer.active + Math.sin(time * 0.5) * 0.05,
      0.06 - pointer.y * 0.16 * pointer.active + Math.sin(time * 0.4) * 0.03,
    );

    // Dim the portrait behind the intro statement.
    u.uExposure.value = config.exposure * (1 - 0.45 * recede * (1 - m1));

    // --- DOM ---
    // Works strip slides with the scroll; the counter shows the tile nearest
    // the middle of the screen.
    const st = layout.strip;
    const offset = st.start - workProgress * st.travel;
    track.style.transform = `translate3d(${offset}px, 0, 0)`;
    // Tile centres are measured from the sticky container's left edge (the
    // screen's), so a tile's on-screen centre is its centre plus the offset.
    let index = 0;
    st.centres.forEach((centre, i) => {
      if (Math.abs(centre + offset - innerWidth / 2) < Math.abs(st.centres[index] + offset - innerWidth / 2)) index = i;
    });
    if (index !== activeWork) {
      workIndex.textContent = String(index + 1).padStart(2, '0');
      activeWork = index;
    }
    workBar.style.transform = `scaleX(${workProgress})`;
    cursor?.update(dt);

    // Skipping the intro, wait for the real shapes rather than flash empty ones.
    if (shapes || !skipIntro) field.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (skipIntro) document.documentElement.classList.add('is-ready');
}

boot().catch((error) => {
  console.error(error);
  document.documentElement.classList.add('is-ready', 'no-webgl');
});
