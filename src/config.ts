export type PortraitMode = 'alpha' | 'luma';

export const config = {
  /** Particles on desktop. Touch devices get `count * mobileRatio`. */
  count: 44000,
  mobileRatio: 0.5,

  color: '#f1efe9',
  /** Tint the dots pick up near the cursor. */
  accent: '#9db8ff',

  portrait: {
    /**
     * null = the built-in placeholder bust. To use a photo, drop it in
     * /public and point this at it, e.g. '/portrait.png'.
     */
    src: null as string | null,
    /**
     * 'alpha' — cut-out PNG with a transparent background (best).
     * 'luma'  — subject lit against a dark/black background.
     */
    mode: 'alpha' as PortraitMode,
    /** Optional greyscale depth map with the same framing (white = near). */
    depthSrc: null as string | null,
    /** How far the face bulges toward the camera, in portrait heights. */
    depth: 0.28,
  },

  formationSeconds: 2.6,
  exposure: 0.62,
  /** Base point size; the shader divides it by distance to the camera. */
  pointSize: 7,
};
