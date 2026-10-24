import 'lenis/dist/lenis.css';
import './style.css';
import Lenis from 'lenis';
import { config } from './config';
import { buildShapes } from './particles/shapes';
import { ParticleField } from './particles/ParticleField';
import { createCursor } from './effects/cursor';
import { attachDissolve } from './effects/dissolve';
import { setupReveals } from './effects/reveal';
import { createPreloader } from './effects/preloader';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = matchMedia('(pointer: coarse)').matches;
/** `?skip-intro` jumps straight to the formed portrait — handy while designing. */
const skipIntro = reducedMotion || new URLSearchParams(location.search).has('skip-intro');

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const smooth = (v: number) => v * v * (3 - 2 * v);
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
  // Always start at the top so the portrait forms in view.
  if (!skipIntro) {
    history.scrollRestoration = 'manual';
    scrollTo(0, 0);
  }
  const preloader = createPreloader(el('[data-preloader]'), skipIntro ? 0 : 1.1);
  const count = Math.round(config.count * (coarsePointer ? config.mobileRatio : 1));
  const [shapes] = await Promise.all([buildShapes(count), document.fonts.ready]);

  const field = new ParticleField(el('[data-field]'), shapes, {
    color: config.color,
    accent: config.accent,
    exposure: config.exposure,
    pointSize: config.pointSize,
    maxPixelRatio: coarsePointer ? 1.5 : 2,
  });
  const u = field.uniforms;

  const lenis = reducedMotion ? null : new Lenis({ lerp: 0.085, anchors: true });
  const cursor = coarsePointer ? null : createCursor(el('[data-cursor]'));
  if (!coarsePointer && !reducedMotion) document.querySelectorAll<HTMLElement>('[data-dissolve]').forEach(attachDissolve);
  setupReveals(document.querySelectorAll<HTMLElement>('.statement'));

  const sections = {
    hero: el('#hero'),
    globe: el('#globe'),
    country: el('#country'),
    works: el('#works'),
    playground: el('#playground'),
    contact: el('#contact'),
  };
  const outlineTarget = el('[data-outline-target]');
  const workItems = Array.from(document.querySelectorAll<HTMLElement>('[data-works] > li'));
  const workIndex = el('[data-work-index]');
  const workBar = el('[data-work-progress]');
  el('[data-work-total]').textContent = String(workItems.length).padStart(2, '0');

  // Layout: where each shape sits for the current viewport.
  const layout = {
    narrow: false,
    portrait: { scale: 1, x: 0, y: 0 },
    globe: { radius: 1, x: 0, y: 0 },
    country: { scale: 1, x: 0, y: 0 },
  };
  const applyLayout = () => {
    field.resize();
    const { width: W, height: H } = field.view;
    const narrow = innerWidth < 820 || W / H < 0.9;
    layout.narrow = narrow;

    // Portrait: anchored to the bottom edge, as tall as fits.
    let pScale = H * (narrow ? 0.7 : 0.88);
    // On phones the shoulders may run off the sides so the face stays large.
    pScale = Math.min(pScale, (W * (narrow ? 1.45 : 0.9)) / shapes.portraitAspect);
    layout.portrait = { scale: pScale, x: 0, y: -H / 2 + pScale / 2 };

    layout.globe = narrow
      ? { radius: Math.min(W * 0.38, H * 0.22), x: 0, y: H * 0.18 }
      : { radius: H * 0.3, x: W * 0.2, y: 0 };

    const cScale = narrow ? H * 0.5 : H * 0.82;
    layout.country = narrow ? { scale: cScale, x: 0, y: H * 0.14 } : { scale: cScale, x: W * 0.2, y: 0 };

    u.uHelix.value.set(W * 1.7, H * (narrow ? 0.07 : 0.1), narrow ? H * 0.12 : -H * 0.04, 0);
    u.uTunnel.value.x = Math.max(W, H) * 0.2;
  };
  applyLayout();
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(applyLayout, 100);
  });

  // Pointer, in NDC, smoothed.
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, active: 0, inside: 0 };
  if (!coarsePointer && !reducedMotion) {
    window.addEventListener('pointermove', (e) => {
      pointer.tx = (e.clientX / innerWidth) * 2 - 1;
      pointer.ty = -((e.clientY / innerHeight) * 2 - 1);
      pointer.inside = 1;
    });
    document.addEventListener('pointerleave', () => (pointer.inside = 0));
  }

  let formation = skipIntro ? 1 : 0;
  let formationStarted = skipIntro;
  let time = 0;
  let turbulence = 0;
  let lastScroll = scrollY;
  let activeWork = -1;
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
    const m4 = enter(sections.playground);
    const m5 = enter(sections.contact);
    const workProgress = through(sections.works);
    const playProgress = through(sections.playground);
    // The globe turns to face the country before morphing into it.
    const focus = smooth(clamp01((vh * 1.5 - top(sections.country)) / (vh * 0.6)));
    const outlineRect = outlineTarget.getBoundingClientRect();

    // --- inputs ---
    const velocity = lenis ? Math.abs(lenis.velocity) : Math.abs(scrollY - lastScroll);
    lastScroll = scrollY;
    turbulence = damp(turbulence, reducedMotion ? 0 : clamp01(velocity / 70), 0.15, dt);
    pointer.x = damp(pointer.x, pointer.tx, 0.35, dt);
    pointer.y = damp(pointer.y, pointer.ty, 0.35, dt);
    pointer.active = damp(pointer.active, pointer.inside, pointer.inside ? 0.3 : 0.8, dt);

    if (formationStarted) formation = Math.min(formation + dt / config.formationSeconds, 1);

    // --- uniforms ---
    u.uTime.value = time;
    u.uFormation.value = formation;
    u.uMorph.value.set(m1, m2, m3, m4);
    u.uMorph5.value = m5;
    u.uTurbulence.value = turbulence;
    u.uPointer.value.set(pointer.x, pointer.y);
    u.uPointerActive.value = pointer.active;

    const p = layout.portrait;
    u.uPortrait.value.set(p.scale * (1 - 0.1 * recede), p.x, p.y, -0.7 * recede);
    u.uHead.value.set(
      pointer.x * 0.32 * pointer.active + Math.sin(time * 0.17) * 0.09 - recede * 0.35,
      -pointer.y * 0.12 * pointer.active + Math.sin(time * 0.11 + 1.3) * 0.03,
    );

    const g = layout.globe;
    u.uGlobe.value.set(g.radius, g.x, g.y, 0);
    const spin = wrapAngle(time * 0.16 - 0.6);
    const [focusLon, focusLat] = shapes.countryFocus;
    const yaw = spin + wrapAngle(-rad(focusLon) - spin) * focus;
    u.uGlobeRot.value.set(yaw, 0.32 + (rad(focusLat) - 0.32) * focus);

    const c = layout.country;
    u.uCountry.value.set(c.scale, c.x, c.y, 0);
    u.uCountryYaw.value = Math.sin(time * 0.35) * 0.16 + pointer.x * 0.2 * pointer.active;

    u.uHelix.value.w = workProgress;
    u.uTunnel.value.y = playProgress * 0.6;
    u.uOutline.value.copy(field.rectToWorld(outlineRect, layout.narrow ? 8 : 14));

    // Dim the portrait behind the intro statement.
    u.uExposure.value = config.exposure * (1 - 0.45 * recede * (1 - m1));

    // --- DOM ---
    const index = Math.min(workItems.length - 1, Math.floor(workProgress * workItems.length));
    if (index !== activeWork) {
      workItems.forEach((item, i) => item.classList.toggle('is-active', i === index));
      workIndex.textContent = String(index + 1).padStart(2, '0');
      activeWork = index;
    }
    workBar.style.transform = `scaleX(${workProgress})`;
    cursor?.update(dt);

    field.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  await preloader.finish();
  document.documentElement.classList.add('is-ready');
  formationStarted = true;
}

boot().catch((error) => {
  console.error(error);
  document.documentElement.classList.add('is-ready', 'no-webgl');
});
