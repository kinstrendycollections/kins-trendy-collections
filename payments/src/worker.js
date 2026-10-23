// Kins Payments & Orders: backend Worker.
//
// Customer routes (called from the storefront cart):
//   GET  /api/health                  safe diagnostics (no secret values shown)
//   POST /api/orders                  create an order (M-Pesa or cash on delivery)
//   POST /api/orders/pay              send the M-Pesa prompt (STK Push) to the customer's phone
//   POST /api/orders/status           payment progress for the "waiting" screen
// Safaricom route:
//   POST /api/mpesa/callback/<token>  Safaricom reports the payment result here
// Owner routes (need the x-admin-key header = ADMIN_PASSWORD):
//   GET  /api/admin/orders            latest orders
//   POST /api/admin/orders/fee        set the delivery fee for an order
//   POST /api/admin/orders/pay        send the M-Pesa prompt for an order
//   POST /api/admin/orders/update     change order status / mark cash collected
//
// Secrets (Cloudflare dashboard, never in this file):
//   ADMIN_PASSWORD, DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET,
//   DARAJA_SHORTCODE, DARAJA_PASSKEY
// Database: D1 binding "DB" (tables are created automatically on first use).

const SANITY_API = 'v2024-01-01';
const MAX_LINES = 20;
const MAX_QTY = 20;
const MAX_STK_ATTEMPTS = 5;
const STK_COOLDOWN_SECONDS = 90; // do not send a second prompt while the first may still be open
const QUERY_AFTER_SECONDS = 20; // ask Safaricom directly if no callback has arrived by then
const QUERY_EVERY_SECONDS = 15;
const ORDER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const ORDER_STATUSES = ['new', 'confirmed', 'delivered', 'cancelled'];
const PAID_STATES = ['paid', 'cod_paid'];

// Must match the "Footwear" group in src/lib/categories.js.
// Adding a footwear category there means adding it here too.
const FOOTWEAR_CATEGORIES = ['ladies-shoes', 'mens-shoes', 'gumboots', 'shoes'];

// ---------- small helpers ----------

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
}

function fail(message, status = 400) {
  return json({ ok: false, error: message }, status);
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

function isAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  return safeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_PASSWORD);
}

function allowedOrigins(env) {
  return [env.SITE_URL, ...String(env.ALLOWED_ORIGINS || '').split(',')]
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  if (origin && allowedOrigins(env).includes(origin)) {
    return {
      'access-control-allow-origin': origin,
      vary: 'origin',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-admin-key',
      'access-control-max-age': '86400',
    };
  }
  return {};
}

function clean(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const nowIso = () => new Date().toISOString();
const secondsSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 1000 : Infinity);

// 0712 345 678 / +254712345678 / 712345678  ->  254712345678. Returns '' if not a Kenyan mobile number.
export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  let intl = '';
  if (digits.startsWith('254')) intl = digits;
  else if (digits.startsWith('0')) intl = '254' + digits.slice(1);
  else if (digits.length === 9) intl = '254' + digits;
  return /^254[17]\d{8}$/.test(intl) ? intl : '';
}

export function makeOrderNumber() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = 'KTC-';
  for (const b of bytes) out += ORDER_ALPHABET[b % ORDER_ALPHABET.length];
  return out; // 10 characters, fits M-Pesa's 12-character account reference
}

export function isFootwear(category) {
  return FOOTWEAR_CATEGORIES.includes(category);
}

// Checks the shape of what the cart sends. Prices are NOT taken from here;
// they are looked up in Sanity (see createOrder).
export function validateOrderInput(input, { allowCod = false } = {}) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Missing order details.' };
  const c = input.customer || {};

  const name = clean(c.name, 80);
  if (name.length < 2) return { ok: false, error: 'Please enter your name.' };

  const phone = normalizePhone(c.phone);
  if (!phone) return { ok: false, error: 'Please enter a valid Safaricom phone number, e.g. 0712 345 678.' };

  let mpesaPhone = phone;
  if (clean(c.mpesaPhone, 20)) {
    mpesaPhone = normalizePhone(c.mpesaPhone);
    if (!mpesaPhone) return { ok: false, error: 'The M-Pesa phone number is not valid.' };
  }

  const county = clean(c.county, 40);
  if (county.length < 3) return { ok: false, error: 'Please enter your county.' };
  const area = clean(c.area, 80);
  if (area.length < 2) return { ok: false, error: 'Please enter your delivery area or town.' };
  const address = clean(c.address, 200);
  if (address.length < 3) return { ok: false, error: 'Please enter your delivery address or landmark.' };
  const notes = clean(c.notes, 300);

  const payment = input.payment;
  if (payment !== 'mpesa' && !(payment === 'cod' && allowCod)) return { ok: false, error: 'Please pay with M-Pesa.' };

  if (!Array.isArray(input.items) || input.items.length < 1) return { ok: false, error: 'Your cart is empty.' };
  if (input.items.length > MAX_LINES) return { ok: false, error: 'Too many items in one order.' };
  const items = [];
  for (const raw of input.items) {
    const slug = clean(raw?.slug, 120);
    const qty = Number(raw?.qty);
    if (!/^[a-z0-9-]+$/.test(slug)) return { ok: false, error: 'An item in your cart is not valid.' };
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { ok: false, error: 'An item quantity is not valid.' };
    items.push({ slug, qty, size: clean(raw?.size, 20) });
  }

  return { ok: true, value: { customer: { name, phone, mpesaPhone, county, area, address, notes }, payment, items } };
}

// Safaricom wants yyyyMMddHHmmss in East Africa Time.
export function eatTimestamp(date = new Date()) {
  return new Date(date.getTime() + 3 * 3600 * 1000)
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
}

export function stkPassword(shortcode, passkey, timestamp) {
  return btoa(`${shortcode}${passkey}${timestamp}`);
}

// Pulls the useful fields out of Safaricom's callback body.
export function parseCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb || !cb.CheckoutRequestID) return null;
  const meta = {};
  for (const item of cb.CallbackMetadata?.Item || []) meta[item.Name] = item.Value;
  return {
    checkoutRequestId: String(cb.CheckoutRequestID),
    merchantRequestId: cb.MerchantRequestID ? String(cb.MerchantRequestID) : null,
    resultCode: Number(cb.ResultCode),
    resultDesc: clean(cb.ResultDesc, 200),
    amount: meta.Amount !== undefined ? Number(meta.Amount) : null,
    receipt: meta.MpesaReceiptNumber ? String(meta.MpesaReceiptNumber) : null,
  };
}

// Plain-English reasons for the common M-Pesa result codes.
export function friendlyReason(code, desc) {
  if (code === 1032) return 'The M-Pesa request was cancelled on your phone.';
  if (code === 1037) return 'The M-Pesa request timed out. Please try again and enter your PIN quickly.';
  if (code === 2001) return 'The M-Pesa PIN was wrong. Please try again.';
  if (code === 1) return 'There was not enough money in the M-Pesa account.';
  return desc || 'The M-Pesa payment did not go through.';
}

// ---------- database ----------

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      mpesa_phone TEXT NOT NULL,
      county TEXT NOT NULL,
      area TEXT NOT NULL,
      address TEXT NOT NULL,
      notes TEXT,
      payment_method TEXT NOT NULL,
      subtotal INTEGER NOT NULL,
      delivery_fee INTEGER,
      status TEXT NOT NULL DEFAULT 'new',
      payment_status TEXT NOT NULL,
      mpesa_receipt TEXT,
      paid_amount INTEGER,
      paid_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      unit_price INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      size TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      checkout_request_id TEXT NOT NULL UNIQUE,
      merchant_request_id TEXT,
      amount INTEGER NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result_code INTEGER,
      result_desc TEXT,
      receipt TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      queried_at TEXT
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_items_order ON order_items (order_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id)'),
  ]);
  schemaReady = true;
}

const amountDue = (order) => (order.delivery_fee === null || order.delivery_fee === undefined ? null : order.subtotal + order.delivery_fee);

async function getOrder(env, orderNumber) {
  return env.DB.prepare('SELECT * FROM orders WHERE order_number = ?').bind(clean(orderNumber, 20).toUpperCase()).first();
}

// ---------- Sanity (prices are always read here, never trusted from the browser) ----------

async function fetchProducts(env, slugs) {
  const query = '*[_type=="product" && slug.current in $slugs]{"slug": slug.current, name, price, category, inStock}';
  const url =
    `https://${env.SANITY_PROJECT_ID}.api.sanity.io/${SANITY_API}/data/query/${env.SANITY_DATASET}` +
    `?query=${encodeURIComponent(query)}&$slugs=${encodeURIComponent(JSON.stringify(slugs))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load product prices');
  const data = await res.json();
  return data.result || [];
}

// ---------- create order ----------

async function createOrder(env, input) {
  // Cash on delivery is switched off for now. To turn it on later, add the plain
  // variable ENABLE_COD = "true" in wrangler.jsonc and commit.
  // Spam trap: the checkout form has a hidden "website" box that people never fill in.
  // If it has text, pretend all is well but save nothing.
  if (input && typeof input === 'object' && clean(input.website, 100)) {
    return json({ ok: true, orderNumber: 'KTC-000000', paymentMethod: 'mpesa', subtotal: 0, deliveryFee: null, amountDue: null, paymentStatus: 'unpaid' });
  }
  const checked = validateOrderInput(input, { allowCod: env.ENABLE_COD === 'true' });
  if (!checked.ok) return fail(checked.error);
  const { customer, payment, items } = checked.value;

  let products;
  try {
    products = await fetchProducts(env, [...new Set(items.map((i) => i.slug))]);
  } catch (e) {
    return fail('We could not check the prices right now. Please try again in a moment.', 502);
  }
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const lines = [];
  const needSize = [];
  for (const item of items) {
    const p = bySlug.get(item.slug);
    if (!p) return fail('One of the items in your cart is no longer available. Please remove it and try again.');
    if (p.inStock === false) return fail(`${p.name} is out of stock.`);
    const price = Math.round(Number(p.price));
    if (!Number.isFinite(price) || price <= 0) return fail(`${p.name} cannot be ordered right now.`);
    if (isFootwear(p.category) && !item.size) needSize.push({ slug: item.slug, name: p.name });
    lines.push({ slug: item.slug, name: p.name, category: p.category || '', unit_price: price, qty: item.qty, size: item.size || null });
  }
  if (needSize.length > 0) {
    return json({ ok: false, error: `Please choose a size for ${needSize[0].name}.`, needSize: needSize.map((n) => n.slug) }, 400);
  }
  const subtotal = lines.reduce((sum, l) => sum + l.unit_price * l.qty, 0);
  const paymentStatus = payment === 'cod' ? 'cod' : 'unpaid';

  const db = env.DB;
  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNumber = makeOrderNumber();
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO orders (order_number, created_at, customer_name, phone, mpesa_phone, county, area, address, notes,
               payment_method, subtotal, delivery_fee, status, payment_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'new', ?)`
          )
          .bind(orderNumber, nowIso(), customer.name, customer.phone, customer.mpesaPhone, customer.county, customer.area, customer.address, customer.notes || null, payment, subtotal, paymentStatus),
        ...lines.map((l) =>
          db
            .prepare(
              `INSERT INTO order_items (order_id, slug, name, category, unit_price, qty, size)
               VALUES ((SELECT id FROM orders WHERE order_number = ?), ?, ?, ?, ?, ?, ?)`
            )
            .bind(orderNumber, l.slug, l.name, l.category, l.unit_price, l.qty, l.size)
        ),
      ]);
      return json({
        ok: true,
        orderNumber,
        paymentMethod: payment,
        subtotal,
        deliveryFee: null,
        amountDue: null,
        paymentStatus,
      });
    } catch (e) {
      if (!String(e?.message || e).includes('UNIQUE')) {
        console.error('createOrder failed', e);
        return fail('We could not save your order. Please try again or message us on WhatsApp.', 500);
      }
      // order-number clash (very rare): try a new number
    }
  }
  return fail('We could not save your order. Please try again.', 500);
}

// ---------- Daraja (M-Pesa) ----------

const darajaBase = (env) => (env.DARAJA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');

function darajaConfigured(env) {
  return Boolean(env.DARAJA_CONSUMER_KEY && env.DARAJA_CONSUMER_SECRET && env.DARAJA_SHORTCODE && env.DARAJA_PASSKEY && env.ADMIN_PASSWORD);
}

// The callback address contains a token derived from ADMIN_PASSWORD, so nobody
// can send fake "payment received" messages to it.
async function callbackToken(env) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(String(env.ADMIN_PASSWORD)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('mpesa-callback-v1'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

async function darajaToken(env) {
  const res = await fetch(`${darajaBase(env)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { authorization: 'Basic ' + btoa(`${env.DARAJA_CONSUMER_KEY}:${env.DARAJA_CONSUMER_SECRET}`) },
  });
  if (!res.ok) throw new Error(`Safaricom login failed (${res.status}). Check the Daraja consumer key and secret.`);
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error('Safaricom did not give a login token.');
  return data.access_token;
}

async function darajaPost(env, path, payload) {
  const token = await darajaToken(env);
  const res = await fetch(`${darajaBase(env)}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Sends the "enter your M-Pesa PIN" prompt to the customer's phone.
async function sendStkPush(env, request, order, phoneOverride) {
  if (!darajaConfigured(env)) return fail('M-Pesa is not set up yet.', 503);
  if (order.status === 'cancelled') return fail('This order was cancelled.');
  if (PAID_STATES.includes(order.payment_status)) return fail('This order is already paid.');
  const due = amountDue(order);
  if (due === null) return fail('The delivery fee for this order has not been confirmed yet.');
  if (due < 1) return fail('Nothing to pay on this order.');

  const phone = phoneOverride ? normalizePhone(phoneOverride) : order.mpesa_phone;
  if (!phone) return fail('The M-Pesa phone number is not valid.');

  const last = await env.DB.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1').bind(order.id).first();
  const attempts = await env.DB.prepare('SELECT COUNT(*) AS n FROM payments WHERE order_id = ?').bind(order.id).first();
  if (attempts.n >= MAX_STK_ATTEMPTS) return fail('Too many payment attempts. Please contact us on WhatsApp and we will help.');
  if (last && last.status === 'pending' && secondsSince(last.created_at) < STK_COOLDOWN_SECONDS) {
    return fail('A payment request was just sent to your phone. Enter your M-Pesa PIN, or wait a minute and try again.', 429);
  }

  const timestamp = eatTimestamp();
  const callbackUrl = `${new URL(request.url).origin}/api/mpesa/callback/${await callbackToken(env)}`;
  let result;
  try {
    result = await darajaPost(env, '/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: env.DARAJA_SHORTCODE,
      Password: stkPassword(env.DARAJA_SHORTCODE, env.DARAJA_PASSKEY, timestamp),
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline', // Paybill. A Till number would use CustomerBuyGoodsOnline.
      Amount: due,
      PartyA: phone,
      PartyB: env.DARAJA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: order.order_number,
      TransactionDesc: 'Kins order',
    });
  } catch (e) {
    console.error('STK push error', e);
    return fail(String(e.message || 'Could not reach Safaricom. Please try again.'), 502);
  }

  const d = result.data;
  if (!result.ok || String(d.ResponseCode) !== '0' || !d.CheckoutRequestID) {
    console.error('STK push refused', result.status, JSON.stringify(d));
    return fail(clean(d.errorMessage || d.ResponseDescription || 'Safaricom did not accept the payment request.', 200), 502);
  }

  await env.DB.batch([
    env.DB
      .prepare('INSERT INTO payments (order_id, checkout_request_id, merchant_request_id, amount, phone, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(order.id, String(d.CheckoutRequestID), d.MerchantRequestID ? String(d.MerchantRequestID) : null, due, phone, 'pending', nowIso()),
    env.DB.prepare("UPDATE orders SET payment_status = 'pending' WHERE id = ? AND payment_status NOT IN ('paid','cod_paid')").bind(order.id),
  ]);
  return json({ ok: true, orderNumber: order.order_number, amountDue: due, message: 'Check your phone and enter your M-Pesa PIN.' });
}

// Records the outcome of one payment attempt. Safe to call twice for the same payment.
async function applyPaymentResult(env, r) {
  const pay = await env.DB.prepare('SELECT * FROM payments WHERE checkout_request_id = ?').bind(r.checkoutRequestId).first();
  if (!pay) {
    console.error('Callback for unknown payment', r.checkoutRequestId);
    return;
  }
  if (pay.status !== 'pending') return; // already handled
  const now = nowIso();

  if (r.resultCode === 0) {
    // If Safaricom told us the amount, it must match what we asked for.
    const amountOk = r.amount === null || r.amount === pay.amount;
    const orderStatus = amountOk ? 'paid' : 'review';
    await env.DB.batch([
      env.DB
        .prepare("UPDATE payments SET status = 'success', result_code = 0, result_desc = ?, receipt = ?, updated_at = ? WHERE id = ?")
        .bind(r.resultDesc, r.receipt, now, pay.id),
      env.DB
        .prepare('UPDATE orders SET payment_status = ?, mpesa_receipt = ?, paid_amount = ?, paid_at = ? WHERE id = ?')
        .bind(orderStatus, r.receipt, r.amount ?? pay.amount, now, pay.order_id),
    ]);
  } else {
    await env.DB.batch([
      env.DB
        .prepare("UPDATE payments SET status = 'failed', result_code = ?, result_desc = ?, updated_at = ? WHERE id = ?")
        .bind(r.resultCode, r.resultDesc, now, pay.id),
      env.DB
        .prepare("UPDATE orders SET payment_status = 'failed' WHERE id = ? AND payment_status NOT IN ('paid','cod_paid','review')")
        .bind(pay.order_id),
    ]);
  }
}

// If the callback never arrives, ask Safaricom directly.
async function queryPendingPayment(env, pay) {
  await env.DB.prepare('UPDATE payments SET queried_at = ? WHERE id = ?').bind(nowIso(), pay.id).run();
  const timestamp = eatTimestamp();
  try {
    const { data } = await darajaPost(env, '/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: env.DARAJA_SHORTCODE,
      Password: stkPassword(env.DARAJA_SHORTCODE, env.DARAJA_PASSKEY, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: pay.checkout_request_id,
    });
    if (data.ResultCode === undefined || data.ResultCode === null) return; // still being processed
    await applyPaymentResult(env, {
      checkoutRequestId: pay.checkout_request_id,
      merchantRequestId: pay.merchant_request_id,
      resultCode: Number(data.ResultCode),
      resultDesc: clean(data.ResultDesc, 200),
      amount: null, // the query does not return the amount or the receipt number
      receipt: null,
    });
  } catch (e) {
    console.error('STK query error', e);
  }
}

async function handleCallback(request, env, token) {
  const ok = json({ ResultCode: 0, ResultDesc: 'Accepted' });
  if (!env.ADMIN_PASSWORD || !safeEqual(token, await callbackToken(env))) return json({ ok: false }, 403);
  try {
    await ensureSchema(env);
    const parsed = parseCallback(await request.json().catch(() => null));
    if (parsed) await applyPaymentResult(env, parsed);
  } catch (e) {
    console.error('callback error', e);
  }
  return ok;
}

// ---------- customer routes ----------

async function findCustomerOrder(env, body) {
  const order = await getOrder(env, body?.orderNumber);
  const phone = normalizePhone(body?.phone);
  if (!order || !phone || order.phone !== phone) return null; // same answer for "no such order" and "wrong phone"
  return order;
}

async function customerPay(request, env) {
  const body = await request.json().catch(() => null);
  const order = await findCustomerOrder(env, body);
  if (!order) return fail('We could not find that order. Check the order number and phone number.', 404);
  if (order.payment_method !== 'mpesa') return fail('This order is cash on delivery.');
  return sendStkPush(env, request, order, clean(body.mpesaPhone, 20));
}

async function customerStatus(env, request) {
  const body = await request.json().catch(() => null);
  const order = await findCustomerOrder(env, body);
  if (!order) return fail('We could not find that order.', 404);

  if (order.payment_status === 'pending') {
    const pay = await env.DB.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1").bind(order.id).first();
    if (pay && secondsSince(pay.created_at) >= QUERY_AFTER_SECONDS && secondsSince(pay.queried_at) >= QUERY_EVERY_SECONDS && darajaConfigured(env)) {
      await queryPendingPayment(env, pay);
    }
  }

  const fresh = await getOrder(env, order.order_number);
  const lastPay = await env.DB.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1').bind(order.id).first();
  return json({
    ok: true,
    orderNumber: fresh.order_number,
    paymentMethod: fresh.payment_method,
    paymentStatus: fresh.payment_status,
    status: fresh.status,
    subtotal: fresh.subtotal,
    deliveryFee: fresh.delivery_fee,
    amountDue: amountDue(fresh),
    receipt: fresh.mpesa_receipt,
    reason: fresh.payment_status === 'failed' && lastPay ? friendlyReason(lastPay.result_code, lastPay.result_desc) : null,
  });
}

// ---------- owner routes ----------

async function adminList(env) {
  const orders = (await env.DB.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 100').all()).results || [];
  const items = (
    await env.DB
      .prepare('SELECT * FROM order_items WHERE order_id IN (SELECT id FROM (SELECT id FROM orders ORDER BY id DESC LIMIT 100))')
      .all()
  ).results;
  const byOrder = new Map();
  for (const it of items || []) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push({ name: it.name, slug: it.slug, qty: it.qty, unitPrice: it.unit_price, size: it.size });
  }
  return json({
    ok: true,
    daraja: env.DARAJA_ENV === 'production' ? 'production' : 'sandbox',
    orders: orders.map((o) => ({
      orderNumber: o.order_number,
      createdAt: o.created_at,
      name: o.customer_name,
      phone: o.phone,
      mpesaPhone: o.mpesa_phone,
      county: o.county,
      area: o.area,
      address: o.address,
      notes: o.notes,
      paymentMethod: o.payment_method,
      subtotal: o.subtotal,
      deliveryFee: o.delivery_fee,
      amountDue: amountDue(o),
      status: o.status,
      paymentStatus: o.payment_status,
      receipt: o.mpesa_receipt,
      paidAt: o.paid_at,
      items: byOrder.get(o.id) || [],
    })),
  });
}

async function adminSetFee(env, body) {
  const order = await getOrder(env, body?.orderNumber);
  if (!order) return fail('Order not found.', 404);
  const fee = Number(body?.fee);
  if (!Number.isInteger(fee) || fee < 0 || fee > 100000) return fail('The delivery fee must be a whole number of shillings (0 or more).');
  if (PAID_STATES.includes(order.payment_status)) return fail('This order is already paid, so the fee cannot change.');
  if (order.payment_status === 'pending') return fail('A payment request is open for this order. Wait for it to finish, then change the fee.');
  await env.DB.prepare('UPDATE orders SET delivery_fee = ? WHERE id = ?').bind(fee, order.id).run();
  return json({ ok: true, amountDue: order.subtotal + fee });
}

async function adminUpdate(env, body) {
  const order = await getOrder(env, body?.orderNumber);
  if (!order) return fail('Order not found.', 404);
  if (body.status !== undefined) {
    if (!ORDER_STATUSES.includes(body.status)) return fail('Unknown status.');
    await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(body.status, order.id).run();
  }
  if (body.codCollected === true) {
    if (order.payment_method !== 'cod') return fail('Only cash on delivery orders can be marked as cash collected.');
    await env.DB.prepare("UPDATE orders SET payment_status = 'cod_paid', paid_at = ? WHERE id = ?").bind(nowIso(), order.id).run();
  }
  return json({ ok: true });
}

// ---------- health ----------

async function health(env) {
  let db = false;
  try {
    await ensureSchema(env);
    await env.DB.prepare('SELECT 1').first();
    db = true;
  } catch (e) {
    console.error('health: database problem', e);
  }
  const has = (k) => Boolean(env[k]);
  return json({
    ok: db && darajaConfigured(env),
    database: db,
    secrets: {
      ADMIN_PASSWORD: has('ADMIN_PASSWORD'),
      DARAJA_CONSUMER_KEY: has('DARAJA_CONSUMER_KEY'),
      DARAJA_CONSUMER_SECRET: has('DARAJA_CONSUMER_SECRET'),
      DARAJA_SHORTCODE: has('DARAJA_SHORTCODE'),
      DARAJA_PASSKEY: has('DARAJA_PASSKEY'),
    },
    mode: env.DARAJA_ENV === 'production' ? 'production' : 'sandbox',
  });
}

// ---------- router ----------

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (path === '/api/health' && method === 'GET') return health(env);

  const cb = /^\/api\/mpesa\/callback\/([A-Za-z0-9]+)$/.exec(path);
  if (cb && method === 'POST') return handleCallback(request, env, cb[1]);

  await ensureSchema(env);

  if (path === '/api/orders' && method === 'POST') return createOrder(env, await request.json().catch(() => null));
  if (path === '/api/orders/pay' && method === 'POST') return customerPay(request, env);
  if (path === '/api/orders/status' && method === 'POST') return customerStatus(env, request);

  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(request, env)) return fail('Wrong password.', 401);
    if (path === '/api/admin/orders' && method === 'GET') return adminList(env);
    const body = method === 'POST' ? await request.json().catch(() => null) : null;
    if (path === '/api/admin/orders/fee' && method === 'POST') return adminSetFee(env, body);
    if (path === '/api/admin/orders/update' && method === 'POST') return adminUpdate(env, body);
    if (path === '/api/admin/orders/pay' && method === 'POST') {
      const order = await getOrder(env, body?.orderNumber);
      if (!order) return fail('Order not found.', 404);
      return sendStkPush(env, request, order, clean(body.mpesaPhone, 20));
    }
  }

  return fail('Not found.', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request); // the owner's order page

    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    let response;
    try {
      response = await route(request, env);
    } catch (e) {
      console.error('Unhandled error', e);
      response = fail('Something went wrong. Please try again.', 500);
    }
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  },
};
