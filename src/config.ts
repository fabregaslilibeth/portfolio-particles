export type PortraitMode = 'auto' | 'alpha' | 'light' | 'luma';

const PORTRAIT_MODES: readonly string[] = ['auto', 'alpha', 'light', 'luma'];

const env = import.meta.env;

// Personal details (name, copy, links, projects, country, portrait) live in
// .env — see .env.example. This file holds the look-and-feel defaults.
export const config = {
  /** Particles on desktop. Touch devices get `count * mobileRatio`. */
  count: 44000,
  mobileRatio: 0.5,

  color: '#f1efe9',
  /** Tint the dots pick up near the cursor. */
  accent: '#9db8ff',

  portrait: {
    /** VITE_PORTRAIT_SRC; null = the built-in placeholder bust. */
    src: env.VITE_PORTRAIT_SRC?.trim() || null,
    /**
     * VITE_PORTRAIT_MODE: 'auto' (default) detects the rest. 'alpha' = cut-out
     * PNG, 'light' = plain light background, 'luma' = dark background.
     */
    mode: (PORTRAIT_MODES.includes(env.VITE_PORTRAIT_MODE?.trim() ?? '') ? env.VITE_PORTRAIT_MODE!.trim() : 'auto') as PortraitMode,
    /** VITE_PORTRAIT_DEPTH_SRC: optional depth map, same framing (white = near). */
    depthSrc: env.VITE_PORTRAIT_DEPTH_SRC?.trim() || null,
    /** How far the face bulges toward the camera, in portrait heights. */
    depth: 0.28,
    /** Local contrast boost so eyes, brows and mouth survive as dots. 0 = off. */
    detail: 0.6,
    /** Share of dots dark areas (hair, shadows) keep, 0..1. */
    shadowDots: 0.14,
    /** >1 thins out mid-tones so features stand out more against skin. */
    contrast: 1.25,
    /** Extra brightness for a photo portrait (the other shapes aren't affected). */
    brightness: 1.9,
    /** Dot size for a photo portrait, relative to the other shapes. */
    dotSize: 0.92,
    /** How much the body fades out toward the bottom edge (0 = no fade). */
    bottomFade: 0.6,
    /**
     * How far the furthest dots fly (in portrait heights) when the head is
     * fully tilted, so a flat photo breaks apart instead of looking flat from
     * the side. Any tilt scatters some; 0 = off.
     */
    turnScatter: 0.22,
  },

  /** How long the intro grid takes to render the portrait, row by row. */
  formationSeconds: 2.6,
  exposure: 0.34,
  /** Base point size; the shader divides it by distance to the camera. */
  pointSize: 7,
};
