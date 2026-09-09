// Cloudflare Pages Function: /api/checkout
//
// This runs on Cloudflare's servers (not in the browser) whenever your
// cart page calls fetch('/api/checkout'). This is where the M-Pesa Daraja
// integration and/or cash-on-delivery order creation will live.
//
// STATUS: stub only — wire up Daraja credentials before going live.
//
// To use this for real M-Pesa STK Push payments, you will need:
//   1. A Safaricom Daraja API account (developer.safaricom.co.ke)
//   2. Your Consumer Key, Consumer Secret, and Till/Paybill Shortcode
//   3. Store those as Cloudflare Pages "environment variable" secrets
//      (never commit them to GitHub) — set them in the Cloudflare
//      dashboard under Workers & Pages > your project > Settings > Environment variables
//
// This function currently just validates the incoming order and echoes
// it back, so the cart page has something real to talk to during testing.

export async function onRequestPost(context) {
  const { request, env } = context;

  let order;
  try {
    order = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid order payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { items, paymentMethod, customer } = order;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return new Response(JSON.stringify({ error: 'Cart is empty' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);

  if (paymentMethod === 'mpesa') {
    // TODO: Call Safaricom Daraja's STK Push endpoint here using
    // env.MPESA_CONSUMER_KEY, env.MPESA_CONSUMER_SECRET, env.MPESA_SHORTCODE
    // (set these as Cloudflare Pages environment variables/secrets).
    return new Response(
      JSON.stringify({
        status: 'pending_integration',
        message: 'M-Pesa STK Push not yet connected. Add Daraja credentials to enable this.',
        total,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Cash on delivery: in a real setup, save this order to a database
  // (e.g. Cloudflare D1) and notify yourself (e.g. via email or WhatsApp API).
  return new Response(
    JSON.stringify({
      status: 'order_received',
      message: 'Order recorded for cash on delivery.',
      total,
      customer: customer ?? null,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
