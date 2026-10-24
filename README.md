# Particle portfolio

A one-page portfolio where a single cloud of ~44,000 WebGL particles forms a
portrait, then morphs as you scroll: a dotted globe, the Philippines, a DNA
helix behind the project slider, a warp tunnel and finally a frame around the
contact email.

Vite + TypeScript + Three.js + Lenis. No framework.

```bash
npm install
npm run dev        # http://127.0.0.1:5180
npm run build      # type-check + production build in dist/
```

Add `?skip-intro` to the URL to jump straight to the formed portrait while
designing.

## Make it yours

| What | Where |
| --- | --- |
| Name, copy, projects, email, links | `index.html` |
| Colours, fonts, spacing | `src/style.css` (`:root` tokens) |
| Particle count, dot colour, glow tint, intro length | `src/config.ts` |

### Your own portrait

1. Export a head-and-shoulders photo as a PNG with a transparent background
   (any background remover works), cropped at the chest, at least 800 px tall.
2. Put it in `public/portrait.png`.
3. In `src/config.ts` set `portrait.src: '/portrait.png'`.

The face's 3D bulge is estimated from the silhouette. For a more accurate
turn, add a greyscale depth map with the same framing (white = near; e.g. from
a depth-estimation model) and set `portrait.depthSrc`.

A photo lit against a black background also works: set `portrait.mode: 'luma'`.

### Another country

```bash
npm run country -- "Japan"
```

Rewrites `src/data/country.json` from Natural Earth's 1:10m outlines, and the
globe automatically turns to face it. Update the "Based in…" text in
`index.html` to match. Countries crossing the antimeridian (Fiji, Russia)
aren't supported.

## How it works

- **One draw call.** Every particle is a vertex in one `THREE.Points`. Each
  shape is just another target position per particle, and the vertex shader
  (`src/particles/shaders.ts`) blends between them with five scroll-driven
  weights.
- **Shapes from images.** `src/particles/sampler.ts` turns any raster into
  points, picking pixels in proportion to brightness. The portrait, the land
  mask for the globe and the country map all go through it at load time, so
  there's no build step for assets.
- **Coherent morphs.** Every cloud is sorted top-to-bottom, so particle *i*
  travels to a nearby spot in the next shape instead of across the screen.
- **Procedural shapes.** The helix, tunnel and contact frame are computed in
  the shader from per-particle random seeds, so they cost no memory and react
  to time, scroll position and scroll speed.
- **Scroll mapping.** `src/main.ts` reads each section's position every
  frame: a shape morphs in as its section rises from the bottom of the screen
  to near the top. Fast scrolling adds turbulence.
- **Details.** Staggered spiral-in intro, twinkle, a cursor that brightens,
  tints and nudges nearby dots, a portrait that turns toward the cursor, and
  links that dissolve into particles on hover (`src/effects/dissolve.ts`).
- **Performance and accessibility.** Touch devices get half the particles and
  a capped pixel ratio. `prefers-reduced-motion` skips the intro, the smooth
  scrolling, the turbulence and the hover effects.

## Credits

Map data: [Natural Earth](https://www.naturalearthdata.com/) (public domain),
via the `world-atlas` package. Fonts: Inter Tight and Instrument Serif
(Google Fonts, OFL).
