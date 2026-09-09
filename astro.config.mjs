import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// IMPORTANT: replace with your real domain once you buy it (e.g. https://kinstrendy.co.ke)
// This is used to generate correct canonical URLs, sitemap.xml and Open Graph tags.
const SITE_URL = 'https://kinstrendy.pages.dev';

export default defineConfig({
  site: SITE_URL,
  integrations: [sitemap()],
  output: 'static',
});
