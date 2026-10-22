// Kins Product Studio: backend.
// Routes:
//   POST /api/ping      checks the admin password
//   POST /api/generate  photos -> AI title, descriptions, category, keywords
//   POST /api/publish   uploads photos to Sanity and creates the product
//
// Secrets (set in the Cloudflare dashboard, never in this file):
//   ADMIN_PASSWORD, GEMINI_API_KEY, SANITY_WRITE_TOKEN

const CATEGORIES = ['utensils', 'clothes', 'shoes', 'electricals', 'hardware'];
const SANITY_API = 'v2024-01-01';
const MAX_IMAGES = 4;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function isAuthed(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  return safeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_PASSWORD);
}

// "data:image/jpeg;base64,XXXX" -> { mime, base64 }
function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ---------- Generate ----------

function buildPrompt({ category, notes }) {
  return [
    'You write product listings for Kins Trendy Collections, an online store in Kenya.',
    'Look carefully at the product photos and write the listing.',
    '',
    'Rules:',
    '- Describe only what you can actually see or what the owner notes say. Do NOT invent brand names, materials, sizes, measurements, warranties or technical specs.',
    '- If something important is unclear (size, material), leave it out rather than guess.',
    '- Plain, friendly English for Kenyan shoppers. No hype, no emojis, no ALL CAPS.',
    '- name: at most 70 characters, searchable (include the product type, colour and a key feature).',
    '- shortDescription: ONE sentence, at most 155 characters, good for a Google snippet.',
    '- description: 70 to 130 words. A short opening paragraph, then a few lines on features and uses.',
    '- keywords: 6 to 10 short search phrases a Kenyan shopper might type.',
    '- category: one of ' + CATEGORIES.join(', ') + '.',
    category ? '- The owner says the category is: ' + category + '. Use it unless the photos clearly show otherwise.' : '',
    notes ? '\nOwner notes (trust these over the photos): ' + notes : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    shortDescription: { type: 'STRING' },
    description: { type: 'STRING' },
    category: { type: 'STRING', enum: CATEGORIES },
    keywords: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['name', 'shortDescription', 'description', 'category', 'keywords'],
};

async function handleGenerate(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY is not set in Cloudflare yet.' }, 500);

  const body = await request.json().catch(() => null);
  const images = Array.isArray(body && body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  const parsed = images.map(parseDataUrl);
  if (!parsed.length || parsed.some((p) => !p)) {
    return json({ error: 'Please add 1 to 4 photos (JPG, PNG or WebP).' }, 400);
  }

  const category = CATEGORIES.includes(body.category) ? body.category : '';
  const notes = String(body.notes || '').slice(0, 500);

  const parts = [{ text: buildPrompt({ category, notes }) }];
  for (const p of parsed) parts.push({ inline_data: { mime_type: p.mime, data: p.base64 } });

  // Try the main model twice, then a backup model twice. 503 and 429 usually
  // mean "busy right now", so a short wait and retry normally fixes it.
  const models = [env.GEMINI_MODEL || 'gemini-3.8-flash', env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash'];
  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.4,
    },
  });

  let res;
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: requestBody,
      });
      if (res.ok || ![429, 500, 503].includes(res.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (res.ok || ![404, 429, 500, 503].includes(res.status)) break;
  }

  if (!res.ok) {
    const detail = await res.text();
    let reason = '';
    try { reason = JSON.parse(detail).error.message || ''; } catch {}
    return json(
      {
        error: `The AI service returned an error (${res.status}). ${reason.slice(0, 160)}`.trim(),
        detail: detail.slice(0, 400),
      },
      502
    );
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let listing;
  try {
    listing = JSON.parse(text);
  } catch {
    return json({ error: 'The AI answer could not be read. Please try Generate again.' }, 502);
  }

  return json({
    listing: {
      name: String(listing.name || '').slice(0, 100),
      shortDescription: String(listing.shortDescription || '').slice(0, 200),
      description: String(listing.description || ''),
      category: CATEGORIES.includes(listing.category) ? listing.category : category || 'utensils',
      keywords: Array.isArray(listing.keywords) ? listing.keywords.slice(0, 12).map(String) : [],
    },
  });
}

// ---------- Publish ----------

async function sanityFetch(env, path, init = {}) {
  const base = `https://${env.SANITY_PROJECT_ID}.api.sanity.io/${SANITY_API}`;
  return fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${env.SANITY_WRITE_TOKEN}`, ...(init.headers || {}) },
  });
}

async function uniqueSlug(env, base) {
  const dataset = env.SANITY_DATASET || 'production';
  let candidate = base || 'product';
  for (let i = 0; i < 10; i++) {
    const q = `*[_type=="product" && slug.current==$s][0]._id`;
    const res = await sanityFetch(
      env,
      `/data/query/${dataset}?query=${encodeURIComponent(q)}&$s=${encodeURIComponent(JSON.stringify(candidate))}`
    );
    if (!res.ok) throw new Error(`Could not check existing products (${res.status}). Is the Sanity token valid?`);
    const out = await res.json();
    if (!out.result) return candidate;
    candidate = `${base}-${i + 2}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function uploadImage(env, parsed, filename) {
  const dataset = env.SANITY_DATASET || 'production';
  const res = await sanityFetch(env, `/assets/images/${dataset}?filename=${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'content-type': parsed.mime },
    body: base64ToBytes(parsed.base64),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Photo upload failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const out = await res.json();
  return out.document._id;
}

function makeSku(category) {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `KTC-${category.slice(0, 3).toUpperCase()}-${rand}`;
}

async function handlePublish(request, env) {
  if (!env.SANITY_WRITE_TOKEN) return json({ error: 'SANITY_WRITE_TOKEN is not set in Cloudflare yet.' }, 500);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Bad request.' }, 400);

  const name = String(body.name || '').trim();
  const category = body.category;
  const price = Number(body.price);
  const compareAtPrice = body.compareAtPrice ? Number(body.compareAtPrice) : null;
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  const parsed = images.map(parseDataUrl);

  if (!name) return json({ error: 'The product needs a name.' }, 400);
  if (!CATEGORIES.includes(category)) return json({ error: 'Pick a category.' }, 400);
  if (!Number.isFinite(price) || price <= 0) return json({ error: 'Enter a price above zero.' }, 400);
  if (compareAtPrice !== null && (!Number.isFinite(compareAtPrice) || compareAtPrice <= price)) {
    return json({ error: 'Original price must be higher than the selling price (or leave it empty).' }, 400);
  }
  if (!parsed.length || parsed.some((p) => !p)) return json({ error: 'Add at least one photo.' }, 400);

  try {
    const dataset = env.SANITY_DATASET || 'production';
    const slug = await uniqueSlug(env, slugify(name));

    const assetIds = [];
    for (let i = 0; i < parsed.length; i++) {
      assetIds.push(await uploadImage(env, parsed[i], `${slug}-${i + 1}.jpg`));
    }

    const doc = {
      _type: 'product',
      name,
      slug: { _type: 'slug', current: slug },
      category,
      price: Math.round(price),
      shortDescription: String(body.shortDescription || '').trim(),
      description: String(body.description || '').trim(),
      sku: String(body.sku || '').trim() || makeSku(category),
      inStock: true,
      images: assetIds.map((id, i) => ({
        _type: 'image',
        _key: `img${i + 1}${Math.random().toString(36).slice(2, 6)}`,
        asset: { _type: 'reference', _ref: id },
      })),
    };
    if (compareAtPrice) doc.compareAtPrice = Math.round(compareAtPrice);

    const res = await sanityFetch(env, `/data/mutate/${dataset}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutations: [{ create: doc }] }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return json({ error: `Sanity refused the product (${res.status}).`, detail: detail.slice(0, 300) }, 502);
    }

    // Ask Cloudflare to rebuild the storefront so the product goes live.
    let rebuild = 'skipped';
    if (env.DEPLOY_HOOK_URL) {
      try {
        const hook = await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' });
        rebuild = hook.ok ? 'started' : 'failed';
      } catch {
        rebuild = 'failed';
      }
    }

    const site = (env.SITE_URL || '').replace(/\/$/, '');
    return json({ ok: true, slug, url: `${site}/products/${slug}`, rebuild });
  } catch (err) {
    return json({ error: err.message || 'Publishing failed.' }, 502);
  }
}

// ---------- Router ----------

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith('/api/')) {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      if (!isAuthed(request, env)) return json({ error: 'Wrong password.' }, 401);

      if (pathname === '/api/ping') return json({ ok: true });
      if (pathname === '/api/generate') return handleGenerate(request, env);
      if (pathname === '/api/publish') return handlePublish(request, env);
      return json({ error: 'Not found.' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
