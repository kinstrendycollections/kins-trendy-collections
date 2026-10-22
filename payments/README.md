# Kins Payments & Orders (Cloudflare Worker)

M-Pesa (Safaricom Daraja STK Push) payments and order recording for the storefront.
Cloudflare project: `kins-payments`, Path = `payments`. Database: D1 `kins-orders` (tables create themselves).

- Owner orders page: the Worker's own address (sign in with ADMIN_PASSWORD)
- Health check: `/api/health` (shows which secrets are set, never their values)
- Secrets (Variables and Secrets, type Secret): ADMIN_PASSWORD, DARAJA_CONSUMER_KEY,
  DARAJA_CONSUMER_SECRET, DARAJA_SHORTCODE, DARAJA_PASSKEY
- `DARAJA_ENV` in wrangler.jsonc is `sandbox`; change to `production` (and commit) only when going live
- Cash on delivery is off; add the plain variable `ENABLE_COD` = `"true"` to turn it on
- Footwear category list in `src/worker.js` must match `src/lib/categories.js`
