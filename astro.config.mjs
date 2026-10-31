import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The live address of the store. It is used for canonical URLs, sitemap.xml,
// Open Graph tags and product structured data. Must match the real domain,
// with no slash at the end.
const SITE_URL = 'https://kinstrendycollections.co.ke';

export default defineConfig({
  site: SITE_URL,
  // Search results, the cart and order status pages are for shoppers, not Google.
  integrations: [sitemap({ filter: (page) => !/\/(search|cart|order)\/?$/.test(page) })],
  output: 'static',
});
