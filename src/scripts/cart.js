// Simple client-side cart stored in localStorage.
// Cart item shape: { slug, name, price, image, qty }

const CART_KEY = 'ktc-cart';

export function getCart() {
  const raw = localStorage.getItem(CART_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  window.dispatchEvent(new CustomEvent('ktc-cart-updated'));
}

export function addToCart(item) {
  const cart = getCart();
  const existing = cart.find((c) => c.slug === item.slug);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...item, qty: 1 });
  }
  saveCart(cart);
}

export function updateQty(slug, qty) {
  let cart = getCart();
  if (qty <= 0) {
    cart = cart.filter((c) => c.slug !== slug);
  } else {
    const item = cart.find((c) => c.slug === slug);
    if (item) item.qty = qty;
  }
  saveCart(cart);
}

export function removeFromCart(slug) {
  const cart = getCart().filter((c) => c.slug !== slug);
  saveCart(cart);
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
  });

  const original = btn.textContent;
  btn.textContent = 'Added ✓';
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
});
