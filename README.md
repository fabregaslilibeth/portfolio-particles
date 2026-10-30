# Particle portfolio

A one-page portfolio where a single cloud of ~44,000 WebGL particles forms a
portrait, then morphs as you scroll through the sections:

| Section | Particles become |
| --- | --- |
| Banner | Your portrait |
| Location | A dotted globe that turns to your country, then the country's map |
| Works | A tilted DNA helix, spinning and swinging round into a spring behind your project tiles |
| Skills | The same helix turned end-on: a vortex spiralling away behind your skills list |
| Contact | A 3D phone showing a chat, beside your contact details — where the dots come to rest |

Vite + TypeScript + Three.js + Lenis. No framework.

```bash
npm install
cp .env.example .env   # then fill in your details
npm run dev            # http://127.0.0.1:5180
npm run build          # type-check + production build in dist/
```

## The intro

There's no separate loading screen — the particles are the loader:

1. **Your name.** Scattered dots spiral in to spell `VITE_NAME` (the last
   word in the italic serif accent; two lines on phones). It assembles in
   step with the real loading work, so it doubles as the progress indicator.
2. **Your job title.** The same letter dots break apart and re-form as
   `VITE_ROLE`, in the same style.
3. **The render.** The title prints your portrait row by row from the top,
   each row lighting up as it flies into place. The hero text and nav fade
   in and scrolling unlocks (it's locked during the intro).

Both words come from `.env`, so changing your name or role there changes the
intro too.

Phase timings live in the `--- intro ---` block of `src/main.ts`; the render
length is `formationSeconds` in `src/config.ts`. Add `?skip-intro` to the URL
to jump straight to the formed portrait while designing (visitors who prefer
reduced motion get the same).

## Your details live in `.env`

Name, role, intro statement, location, email, social links, projects and the
portrait are all `VITE_*` variables — see [`.env.example`](.env.example) for
every key with comments. `.env` is gitignored; on a host (Vercel, Netlify…)
set the same variables in its dashboard.

`plugins/site-content.ts` writes them into `index.html` at build time, so the
text is in the real HTML (good for search and link previews). Values are
HTML-escaped, links must be `https://`, and wrapping a word in `*asterisks*`
sets it in the italic serif accent. A build with the placeholder name or email
still works but prints a warning.

Everything in `.env` ends up public in the built site — it's for content,
never secrets.

| What | Where |
| --- | --- |
| Name, copy, location, email, links, projects, skills, portrait | `.env` |
| Section headings that aren't personal ("Working globally"…) | `index.html` |
| Colours, fonts, spacing | `src/style.css` (`:root` tokens) |
| Particle count, dot colour, glow tint, intro length | `src/config.ts` |

### Your own portrait

1. Put a head-and-shoulders photo (at least 800 px tall) in `public/`.
2. Set `VITE_PORTRAIT_SRC="/your-photo.png"` in `.env` (spaces as `%20`).

`VITE_PORTRAIT_MODE="auto"` works out how to separate you from the
background:

- **Transparent PNG** → used as-is (`alpha`). Most reliable.
- **Plain light background** (white wall, bright office) → cut out
  automatically (`light`): it floods in from the edges through bright,
  colourless pixels and keeps the largest shape. Busy or colourful backgrounds
  can leak in — use a transparent PNG for those.
- **Dark background** → brightness threshold (`luma`).

The photo is then tone-mapped (contrast stretched, local detail boosted) and
dithered into dots, so eyes, brows and mouth stay legible. Side or top
lighting helps; flat light gives a flat face. Fine-tune in `src/config.ts`
under `portrait`: `detail`, `contrast`, `shadowDots`, `brightness`,
`dotSize`, `bottomFade`, `turnScatter`.

A photo has no real depth, so the portrait never shows itself side-on. It
loads crisp and facing the camera. Moving the mouse turns the head toward the
cursor and scatters the dots like dust (most shift a little, a few fly far;
faster movement scatters more), and brushing over the face scatters the dots
under the cursor. About a second after the mouse stops — wherever it rests —
the head turns back and the dots fly back together. Scrolling into the intro
scatters it too. `turnScatter` sets how far the furthest dots fly (0 = off).
For a truer turn, add a greyscale depth map with the same framing (white =
near; e.g. from a depth-estimation model) and set `VITE_PORTRAIT_DEPTH_SRC`.

### Works, skills and contact

Each project in `VITE_PROJECTS` gets a tile — image, title, meta and an
optional link — in a strip that slides sideways as you scroll through the
(sticky) Works section; the section's height is set so the strip's travel
matches the scroll. Set a project's `"image"` to a file in `/public` (16:10
works best); until then it shows one of the placeholders in `public/works/`.

Behind the tiles the particles form a DNA-style double helix, tilted across
the screen and spinning continuously. As you scroll through Works it grows and
swings round in perspective, so it reads as a spring.

When Skills arrives, the same helix keeps turning until it points straight at
you and becomes a vortex — two strands and their rungs spiralling into a
vanishing point that fades out, so the skills text (`VITE_SKILLS`, plain HTML)
stays readable. Skills is sticky (2.5 screens tall, `.skills` in `style.css`),
so the vortex holds with the text pinned until Contact takes over. It twists
as you scroll, bends toward the cursor and roughens when you scroll fast.

In Contact the dots come to rest as a phone showing a chat (status bar,
message bubbles, typing dots, input bar), with dotted side walls so it has
real depth. It sits to the right of your details on desktop and above them on
phones, floating gently and tilting toward the cursor.

### Another country

Set `VITE_COUNTRY` to any Natural Earth country name (e.g. `"Japan"`) and
update `VITE_LOCATION_HEADING`. The outline is extracted from Natural Earth's
1:10m data at build time and the globe turns to face it; an unknown name stops
the build with suggestions. Countries crossing the antimeridian (Fiji, Russia)
aren't supported.

## How it works

- **One draw call.** Every particle is a vertex in one `THREE.Points`. Each
  shape is just another target position per particle, and the vertex shader
  (`src/particles/shaders.ts`) blends between them with four scroll-driven
  weights.
- **Shapes from images.** `src/particles/sampler.ts` turns any raster into
  points, picking pixels in proportion to brightness. The portrait, the land
  mask for the globe, the country map and the phone all go through it at load
  time, so there's no build step for assets.
- **Coherent morphs.** Every cloud is sorted top-to-bottom, so particle *i*
  travels to a nearby spot in the next shape instead of across the screen.
- **One helix, two looks.** The Works spring and the Skills vortex are the
  same procedural helix computed on the GPU from per-particle seeds. `main.ts`
  only changes its length, radius, spin and orientation, so the spring turns
  smoothly into the vortex instead of swapping shapes.
- **Scroll mapping.** `src/main.ts` reads each section's position every
  frame: a shape morphs in as its section rises from the bottom of the screen
  to near the top. Fast scrolling adds turbulence.
- **Details.** The name → job title → render intro, twinkle, a cursor that brightens,
  tints and nudges nearby dots, a portrait that turns toward the cursor, and
  links that dissolve into particles on hover (`src/effects/dissolve.ts`).
- **Performance and accessibility.** Touch devices get half the particles and
  a capped pixel ratio. `prefers-reduced-motion` skips the intro, the smooth
  scrolling, the turbulence and the hover effects.

## Credits

Map data: [Natural Earth](https://www.naturalearthdata.com/) (public domain),
via the `world-atlas` package. Fonts: Inter Tight and Instrument Serif
(Google Fonts, OFL).
