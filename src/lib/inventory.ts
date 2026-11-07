import { StockItem, StockItemInput, StockMove, addDays, money } from './model';

export type StockLevel = 'out' | 'low' | 'ok' | 'untracked';
export type ExpiryLevel = 'expired' | 'soon' | null;

const DISCRETE = new Set([
  'pièce',
  'carton',
  'sachet',
  'boîte',
  'bouteille',
  'canette',
  'paquet',
  'rouleau',
  'pack',
  'seau',
]);

/** Quantities are kept to three decimals so that kilograms and litres stay exact. */
export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

export function stockLevel(item: Pick<StockItem, 'quantity' | 'minQuantity' | 'parQuantity'>) {
  if (item.quantity <= 0) return 'out' as const;
  if (item.minQuantity > 0 && item.quantity <= item.minQuantity) return 'low' as const;
  if (!item.minQuantity && !item.parQuantity) return 'untracked' as const;
  return 'ok' as const;
}

export function expiryLevel(item: Pick<StockItem, 'expiresAt' | 'quantity'>, day: string) {
  if (!item.expiresAt || item.quantity <= 0) return null;
  if (item.expiresAt < day) return 'expired' as const;
  if (item.expiresAt <= addDays(day, 2)) return 'soon' as const;
  return null;
}

export function needsOrder(item: StockItem) {
  const level = stockLevel(item);
  return item.active && (level === 'out' || level === 'low');
}

/** Rounds a suggested order to a quantity a supplier can actually deliver. */
export function roundOrder(quantity: number, unit: string) {
  if (quantity <= 0) return 0;
  if (DISCRETE.has(unit)) return Math.ceil(quantity - 0.0001);
  if (unit === 'g' || unit === 'cl') return Math.ceil(quantity / 10) * 10;
  return Math.ceil(quantity * 2 - 0.0001) / 2;
}

export function suggestedOrder(item: StockItem) {
  if (!needsOrder(item)) return 0;
  const target = item.parQuantity > item.minQuantity ? item.parQuantity : item.minQuantity * 2;
  return roundOrder(Math.max(target - Math.max(0, item.quantity), 0), item.unit) || 1;
}

/**
 * Average daily usage over the window, from outputs, losses and counts below the expected stock.
 * Increases (deliveries, initial stock, counts above the expected stock) are not usage.
 */
export function dailyUsage(item: StockItem, moves: StockMove[], now = new Date(), days = 14) {
  const from = now.getTime() - days * 86400000;
  let used = 0;
  let first = Infinity;
  for (const m of moves) {
    if (m.itemId !== item.id) continue;
    const t = Date.parse(m.at);
    if (t < from) continue;
    first = Math.min(first, t);
    if (m.delta < 0 && (m.kind === 'out' || m.kind === 'loss' || m.kind === 'count'))
      used -= m.delta;
  }
  if (used <= 0 || first === Infinity) return 0;
  // Use the observed span (minimum 3 days) so that a new item is not penalised.
  const span = Math.max(
    3,
    Math.min(days, (now.getTime() - Math.min(first, Date.parse(item.createdAt))) / 86400000),
  );
  return used / span;
}

export function daysLeft(item: StockItem, usage: number) {
  if (usage <= 0) return null;
  return Math.max(0, item.quantity) / usage;
}

export function stockValue(items: StockItem[]) {
  return Math.round(
    items.filter((i) => i.active).reduce((a, i) => a + Math.max(0, i.quantity) * i.unitCost, 0),
  );
}

export function movesValue(
  moves: StockMove[],
  kinds: StockMove['kind'][],
  from: string,
  to: string,
) {
  return Math.round(
    moves
      .filter((m) => kinds.includes(m.kind) && m.at >= from && m.at < to)
      .reduce((a, m) => a + Math.abs(m.delta) * m.unitCost, 0),
  );
}

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
export function qty(n: number) {
  return nf.format(roundQty(n));
}
export function unitLabel(unit: string, n: number) {
  return DISCRETE.has(unit) && Math.abs(n) >= 2 ? unit.replace(/(?<!s)$/, 's') : unit;
}
export function formatQty(n: number, unit: string) {
  return `${qty(n)} ${unitLabel(unit, n)}`;
}

export type OrderGroup = {
  supplier: string;
  lines: { item: StockItem; quantity: number; cost: number }[];
  total: number;
};
export function orderGroups(items: StockItem[], overrides: Record<string, number> = {}) {
  const groups = new Map<string, OrderGroup>();
  for (const item of items) {
    const quantity = overrides[item.id] ?? suggestedOrder(item);
    if (!item.active || quantity <= 0) continue;
    const supplier = item.supplier.trim() || 'Sans fournisseur';
    const group = groups.get(supplier) ?? { supplier, lines: [], total: 0 };
    const cost = Math.round(quantity * item.unitCost);
    group.lines.push({ item, quantity, cost });
    group.total += cost;
    groups.set(supplier, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.supplier === 'Sans fournisseur'
      ? 1
      : b.supplier === 'Sans fournisseur'
        ? -1
        : a.supplier.localeCompare(b.supplier, 'fr'),
  );
}

export function orderMessage(
  group: OrderGroup,
  restaurant = 'Burger House – Saint-Rambert-d’Albon',
) {
  return [
    `Bonjour,`,
    ``,
    `Commande pour ${restaurant} :`,
    ...group.lines.map((l) => `• ${l.item.name} : ${formatQty(l.quantity, l.item.unit)}`),
    ``,
    `Merci de nous confirmer la livraison.`,
    `Bonne journée !`,
  ].join('\n');
}

export function orderSummary(groups: OrderGroup[]) {
  return groups
    .map(
      (g) =>
        `${g.supplier}${g.total ? ` (≈ ${money(g.total)})` : ''}\n` +
        g.lines.map((l) => `• ${l.item.name} : ${formatQty(l.quantity, l.item.unit)}`).join('\n'),
    )
    .join('\n\n');
}

/** A starter list for a burger restaurant. Nothing is added until the manager selects it. */
export const BURGER_CATALOG: StockItemInput[] = [
  ['Steak haché 150 g', 'Viandes', 'pièce', 'Congélateur', 'Gfd', 60, 200],
  ['Steak haché 90 g', 'Viandes', 'pièce', 'Congélateur', 'Gfd', 40, 150],
  ['Poulet pané (filet)', 'Viandes', 'pièce', 'Congélateur', 'Gfd', 30, 100],
  ['Tenders de poulet', 'Viandes', 'kg', 'Congélateur', 'Gfd', 3, 10],
  ['Nuggets', 'Viandes', 'kg', 'Congélateur', 'Gfd', 2, 8],
  ['Bacon tranché', 'Viandes', 'kg', 'Chambre froide', 'Gfd', 1, 4],
  ['Pain burger brioché', 'Pains', 'pièce', 'Réserve sèche', 'Gfd', 60, 200],
  ['Pain burger sésame', 'Pains', 'pièce', 'Réserve sèche', 'Gfd', 40, 150],
  ['Pain wrap / tortilla', 'Pains', 'pièce', 'Réserve sèche', 'Gfd', 20, 60],
  ['Cheddar tranches', 'Fromages', 'pièce', 'Chambre froide', 'Gfd', 80, 300],
  ['Raclette tranches', 'Fromages', 'kg', 'Chambre froide', 'Gfd', 0.5, 2],
  ['Chèvre bûche', 'Fromages', 'pièce', 'Chambre froide', 'Gfd', 2, 6],
  ['Mozzarella sticks', 'Fromages', 'kg', 'Congélateur', 'Gfd', 1, 4],
  ['Salade iceberg', 'Légumes & fruits', 'pièce', 'Chambre froide', 'Carrefour', 4, 12],
  ['Tomates', 'Légumes & fruits', 'kg', 'Chambre froide', 'Carrefour', 2, 6],
  ['Oignons rouges', 'Légumes & fruits', 'kg', 'Réserve sèche', 'Carrefour', 2, 5],
  ['Cornichons', 'Légumes & fruits', 'boîte', 'Réserve sèche', 'Gfd', 1, 3],
  ['Oignons frits', 'Légumes & fruits', 'sachet', 'Réserve sèche', 'Gfd', 1, 4],
  ['Citrons', 'Légumes & fruits', 'kg', 'Frigo', 'Carrefour', 0.5, 2],
  ['Frites surgelées', 'Frites & surgelés', 'kg', 'Congélateur', 'Gfd', 20, 60],
  ['Potatoes', 'Frites & surgelés', 'kg', 'Congélateur', 'Gfd', 5, 20],
  ['Onion rings', 'Frites & surgelés', 'kg', 'Congélateur', 'Gfd', 2, 6],
  ['Huile de friture', 'Frites & surgelés', 'L', 'Réserve sèche', 'Gfd', 10, 30],
  ['Sauce burger', 'Sauces & condiments', 'L', 'Frigo', 'Gfd', 1, 4],
  ['Ketchup', 'Sauces & condiments', 'L', 'Réserve sèche', 'Gfd', 2, 6],
  ['Mayonnaise', 'Sauces & condiments', 'L', 'Frigo', 'Gfd', 2, 6],
  ['Sauce barbecue', 'Sauces & condiments', 'L', 'Réserve sèche', 'Gfd', 1, 3],
  ['Sauce algérienne', 'Sauces & condiments', 'L', 'Réserve sèche', 'Gfd', 1, 3],
  ['Sauce samouraï', 'Sauces & condiments', 'L', 'Réserve sèche', 'Gfd', 1, 3],
  ['Sel', 'Sauces & condiments', 'kg', 'Réserve sèche', 'Carrefour', 1, 3],
  ['Coca-Cola 33 cl', 'Boissons', 'canette', 'Boissons', 'Carrefour', 24, 96],
  ['Coca-Cola Zéro 33 cl', 'Boissons', 'canette', 'Boissons', 'Carrefour', 24, 72],
  ['Fanta 33 cl', 'Boissons', 'canette', 'Boissons', 'Carrefour', 12, 48],
  ['Ice Tea 33 cl', 'Boissons', 'canette', 'Boissons', 'Carrefour', 12, 48],
  ['Oasis 33 cl', 'Boissons', 'canette', 'Boissons', 'Carrefour', 12, 48],
  ['Eau 50 cl', 'Boissons', 'bouteille', 'Boissons', 'Carrefour', 12, 48],
  ['Tiramisu', 'Desserts', 'pièce', 'Frigo', 'Gfd', 6, 24],
  ['Cookies', 'Desserts', 'pièce', 'Réserve sèche', 'Gfd', 10, 40],
  ['Boîtes burger', 'Emballages', 'carton', 'Réserve sèche', 'Gfd', 1, 3],
  ['Barquettes frites', 'Emballages', 'carton', 'Réserve sèche', 'Gfd', 1, 3],
  ['Sacs kraft à emporter', 'Emballages', 'paquet', 'Réserve sèche', 'Gfd', 2, 6],
  ['Pots à sauce + couvercles', 'Emballages', 'paquet', 'Réserve sèche', 'Gfd', 2, 6],
  ['Serviettes', 'Emballages', 'paquet', 'Réserve sèche', 'Gfd', 2, 6],
  ['Papier cuisson / burger', 'Emballages', 'rouleau', 'Réserve sèche', 'Gfd', 1, 4],
  ['Gants nitrile', 'Hygiène & entretien', 'boîte', 'Cuisine', 'Gfd', 2, 6],
  ['Film alimentaire', 'Hygiène & entretien', 'rouleau', 'Réserve sèche', 'Gfd', 1, 3],
  ['Sacs poubelle', 'Hygiène & entretien', 'rouleau', 'Réserve sèche', 'Carrefour', 2, 6],
  ['Produit dégraissant', 'Hygiène & entretien', 'bouteille', 'Réserve sèche', 'Carrefour', 1, 3],
  ['Liquide vaisselle', 'Hygiène & entretien', 'bouteille', 'Réserve sèche', 'Carrefour', 1, 3],
  ['Essuie-tout', 'Hygiène & entretien', 'rouleau', 'Réserve sèche', 'Carrefour', 2, 8],
].map(([name, category, unit, zone, supplier, minQuantity, parQuantity]) => ({
  name: name as string,
  category: category as string,
  unit: unit as string,
  zone: zone as string,
  supplier: supplier as string,
  minQuantity: minQuantity as number,
  parQuantity: parQuantity as number,
  unitCost: 0,
}));
