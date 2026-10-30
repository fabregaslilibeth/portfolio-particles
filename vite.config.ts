import { defineConfig } from 'vite';
import { siteContent } from './plugins/site-content';

export default defineConfig({
  plugins: [siteContent()],
  build: {
    // three.js alone is ~500 kB minified; one chunk is fine for a one-page site.
    chunkSizeWarningLimit: 800,
  },
});
