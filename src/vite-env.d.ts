/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Path to a portrait image in /public, e.g. "/portrait.png". Empty = placeholder bust. */
  readonly VITE_PORTRAIT_SRC?: string;
  /** "alpha" (transparent cut-out) or "luma" (subject on a dark background). */
  readonly VITE_PORTRAIT_MODE?: string;
  /** Optional greyscale depth map with the same framing (white = near). */
  readonly VITE_PORTRAIT_DEPTH_SRC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The VITE_COUNTRY outline, generated at build time by plugins/site-content.ts. */
declare module 'virtual:country' {
  const country: {
    name: string;
    /** Centre as [lon, lat] degrees. */
    focus: [number, number];
    aspect: number;
    rings: number[][][];
  };
  export default country;
}
