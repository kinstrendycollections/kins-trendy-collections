// Simple client-side cart stored in localStorage.
// Cart item shape: { slug, name, price, image, qty, category, size }
// A cart "line" is one slug + size, so the same shoe in two sizes is two lines.

const CART_KEY = 'ktc-cart';

export function lineKey(item) {
  return `${item.slug}|${item.size || ''}`;
}

export function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const cart = raw ? JSON.parse(raw) : [];
    return Array.isArray(cart) ? cart : [];
  } catch {
    return [];
  }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  window.dispatchEvent(new CustomEvent('ktc-cart-updated'));
}

export function addToCart(item) {
  const cart = getCart();
  const existing = cart.find((c) => lineKey(c) === lineKey(item));
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...item, qty: 1 });
  }
  saveCart(cart);
}

export function updateQty(key, qty) {
  let cart = getCart();
  if (qty <= 0) {
    cart = cart.filter((c) => lineKey(c) !== key);
  } else {
    const item = cart.find((c) => lineKey(c) === key);
    if (item) item.qty = qty;
  }
  saveCart(cart);
}

export function removeFromCart(key) {
  saveCart(getCart().filter((c) => lineKey(c) !== key));
}

// Sets the size on one line. If another line already has the same slug and
// size, the two are merged.
export function setSize(key, size) {
  const cart = getCart();
  const line = cart.find((c) => lineKey(c) === key);
  if (!line) return;
  const clean = String(size || '').trim().slice(0, 20);
  if ((line.size || '') === clean) return;
  line.size = clean;
  const twin = cart.find((c) => c !== line && lineKey(c) === lineKey(line));
  if (twin) {
    twin.qty += line.qty;
    cart.splice(cart.indexOf(line), 1);
  }
  saveCart(cart);
}

export function clearCart() {
  saveCart([]);
}

export function cartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

// Wire up any "Add to Cart" buttons on the page (event delegation).
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.add-to-cart');
  if (!btn || btn.disabled) return;

  addToCart({
    slug: btn.dataset.slug,
    name: btn.dataset.name,
    price: Number(btn.dataset.price),
    image: btn.dataset.image,
    category: btn.dataset.category || '',
  });

  const original = btn.textContent;
  btn.textContent = 'Added ✓';
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
});
