// The one list of store categories. Header, footer, category pages and
// product breadcrumbs all read from here, so a new category is added in
// ONE place (plus the dropdown in the Sanity schema and Product Studio).
//
// slug  = what is saved on the product and used in the web address
// label = what shoppers see
// group = used to link related categories together (e.g. all footwear)

export const CATEGORIES = [
  { slug: 'utensils', label: 'Kitchen Utensils', group: 'Home & Kitchen' },
  { slug: 'ladies-shoes', label: "Ladies' Shoes", group: 'Footwear' },
  { slug: 'mens-shoes', label: "Men's Shoes", group: 'Footwear' },
  { slug: 'gumboots', label: 'Gumboots & Work Boots', group: 'Footwear' },
  { slug: 'clothes', label: 'Clothes', group: 'Clothing' },
  { slug: 'electricals', label: 'Electricals', group: 'Electricals' },
  { slug: 'hardware', label: 'Hardware', group: 'Hardware' },
];

// Old category names that may still be on products created earlier.
// They keep working (page + label) until you move those products to a new
// category in the Sanity dashboard.
const LEGACY_LABELS = {
  shoes: 'Shoes',
};

export function categoryLabel(slug) {
  const found = CATEGORIES.find((c) => c.slug === slug);
  return found ? found.label : LEGACY_LABELS[slug] ?? slug;
}

export function categoryGroup(slug) {
  const found = CATEGORIES.find((c) => c.slug === slug);
  return found ? found.group : null;
}

// Only categories that actually have products, so the menu never links to
// an empty page.
export function liveCategories(products) {
  const used = new Set(products.map((p) => p.category));
  return CATEGORIES.filter((c) => used.has(c.slug));
}
