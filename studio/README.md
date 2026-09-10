# Kins Trendy Collections — Admin Dashboard (Sanity Studio)

This is your product-management dashboard. Once set up, you add/edit
products here through a visual form — no code, no GitHub needed for
day-to-day product uploads.

## One-time setup (do this once)

1. Go to **sanity.io** and create a free account.
2. When it asks you to create a project, do so and note down your
   **Project ID** (a short string of letters/numbers, shown in your
   project settings at sanity.io/manage).
3. Open `sanity.config.js` in this `studio` folder (edit it on GitHub,
   same way you edited other files) and replace
   `REPLACE_WITH_YOUR_PROJECT_ID` with your real Project ID. Commit the
   change.
4. In Cloudflare, create a **second** Pages project (Workers & Pages →
   Create application → Pages → Connect to Git), pointing to this same
   GitHub repository, but set:
   - **Root directory:** `studio`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
5. Deploy. You'll get a second free address like
   `kins-trendy-studio.pages.dev` — this is your admin dashboard. Bookmark it.
6. Go back to your **main site's** Cloudflare Pages project → Settings →
   Environment variables, and add:
   - `PUBLIC_SANITY_PROJECT_ID` = your Project ID
   - `PUBLIC_SANITY_DATASET` = `production`
   Then trigger a redeploy of the main site (Deployments tab → Retry
   deployment on the latest one).
7. Finally, so new products show up automatically: in sanity.io/manage,
   go to your project → API → Webhooks → Create webhook. Set the URL to
   a Cloudflare Pages "Deploy Hook" (create one in your main site's
   Cloudflare project → Settings → Builds & deployments → Deploy hooks),
   trigger it on "Create / Update / Delete", dataset `production`.

After this one-time setup, adding a product is just: open your dashboard
link → click "Product" → "Create new" → fill in the form → Publish. Your
live site rebuilds automatically within a minute or two.
