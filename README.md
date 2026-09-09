# Kins Trendy Collections

An online store for kitchen utensils in Kenya, built to grow into clothes,
shoes, electricals and hardware over time.

## What's in this project

- Homepage, category pages, and individual product pages — all with SEO
  built in (page titles, meta descriptions, Schema.org data for Google)
- A working shopping cart (add, remove, change quantity)
- A checkout stub ready for M-Pesa (Daraja API) and cash-on-delivery
- Auto-generated sitemap.xml and robots.txt for search engines
- 6 sample utensil products to get you started — edit or add more in
  `src/data/products.json`

## How this gets online (no terminal needed)

1. Upload this whole folder to your empty GitHub repository using GitHub's
   "Add file → Upload files" button in your browser.
2. Go to Cloudflare Pages, connect it to that GitHub repository.
3. When Cloudflare asks for build settings, use:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Click Deploy. Cloudflare will install everything and publish your site
   automatically — you'll get a free web address like
   `kins-trendy-collections.pages.dev`.

Every time you upload new/changed files to GitHub afterwards, Cloudflare
will automatically rebuild and update your live site within a minute or two.

## Adding or editing products

Open `src/data/products.json` in GitHub (click the file, then the pencil/edit
icon) and copy an existing product block to add a new one. Each product needs:
a unique `slug` (used in the web address), `name`, `price`, `category`,
`description`, and an image path.

## Before you go live for real

- Buy a domain (e.g. `kinstrendycollections.co.ke`) and connect it in
  Cloudflare Pages — this replaces the free `.pages.dev` address and matters
  a lot for local SEO.
- Update `SITE_URL` in `astro.config.mjs` and the sitemap URL in
  `public/robots.txt` to match your real domain.
- Get real product photos (the current ones are simple placeholder
  illustrations, not photos).
- Set up your M-Pesa Daraja API credentials (see comments inside
  `functions/api/checkout.js`) as environment variables in Cloudflare —
  never type API keys directly into your code files.
