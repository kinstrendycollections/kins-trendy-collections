// This file decides where product data comes from.
//
// If you've set up Sanity (the admin dashboard) and added your Project ID
// as an environment variable in Cloudflare Pages called
// PUBLIC_SANITY_PROJECT_ID, this automatically fetches live products from
// your dashboard.
//
// If that variable isn't set yet, it safely falls back to the old
// src/data/products.json file, so nothing breaks while you're setting
// Sanity up.

const PROJECT_ID = import.meta.env.PUBLIC_SANITY_PROJECT_ID;
const DATASET = import.meta.env.PUBLIC_SANITY_DATASET || 'production';

const PRODUCT_QUERY = `*[_type == "product"]{
  "slug": slug.current,
  name,
  price,
  compareAtPrice,
  "currency": "KES",
  category,
  description,
  shortDescription,
  sku,
  inStock,
  "images": images[].asset->url
}`;

export async function fetchProducts() {
  if (!PROJECT_ID) {
    const fallback = await import('../data/products.json');
    return fallback.default;
  }

  const url = `https://${PROJECT_ID}.api.sanity.io/v2024-01-01/data/query/${DATASET}?query=${encodeURIComponent(
    PRODUCT_QUERY
  )}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Sanity request failed: ${res.status}`);
    const json = await res.json();
    return json.result ?? [];
  } catch (err) {
    console.error('Could not fetch products from Sanity, falling back to local data:', err);
    const fallback = await import('../data/products.json');
    return fallback.default;
  }
}
