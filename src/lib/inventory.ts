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

/** Rounds up to whole supplier packs (cartons) when the pack size is known. */
export function roundToPack(quantity: number, item: Pick<StockItem, 'unit' | 'packSize'>) {
  if (quantity <= 0) return 0;
  if (item.packSize && item.packSize > 0)
    return roundQty(Math.ceil(quantity / item.packSize - 0.0001) * item.packSize);
  return roundOrder(quantity, item.unit);
}

export function suggestedOrder(item: StockItem) {
  if (!needsOrder(item)) return 0;
  const target = item.parQuantity > item.minQuantity ? item.parQuantity : item.minQuantity * 2;
  return roundToPack(Math.max(target - Math.max(0, item.quantity), 0), item) || 1;
}

/**
 * Weekly order: what the coming days will use, plus the alert threshold as safety stock,
 * minus what is left. Without usage history yet, it tops the item up to its ideal stock.
 */
export function weeklyOrder(item: StockItem, usage: number, coverDays: number) {
  if (!item.active) return 0;
  const need =
    usage > 0 ? usage * coverDays + item.minQuantity : item.parQuantity || item.minQuantity * 2;
  const missing = need - Math.max(0, item.quantity);
  return missing > 0.0001 ? roundToPack(missing, item) : 0;
}

export function packLabel(quantity: number, item: Pick<StockItem, 'unit' | 'packSize'>) {
  if (!item.packSize || item.packSize <= 0) return formatQty(quantity, item.unit);
  const packs = roundQty(quantity / item.packSize);
  return `${qty(packs)} colis (${formatQty(quantity, item.unit)})`;
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
  // The whole window counts (weekly counts report a week of usage at once); a new item is
  // measured from its creation, with a minimum of 3 days.
  const span = Math.max(3, Math.min(days, (now.getTime() - Date.parse(item.createdAt)) / 86400000));
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
export function orderGroups(
  items: StockItem[],
  overrides: Record<string, number> = {},
  suggest: (item: StockItem) => number = suggestedOrder,
) {
  const groups = new Map<string, OrderGroup>();
  for (const item of items) {
    const quantity = overrides[item.id] ?? suggest(item);
    if (!item.active || quantity <= 0) continue;
    const supplier = item.supplier.trim() || 'Sans fournisseur';
    const group = groups.get(supplier) ?? { supplier, lines: [], total: 0 };
    const cost = Math.round(quantity * item.unitCost);
    group.lines.push({ item, quantity, cost });
    group.total += cost;
    groups.set(supplier, group);
  }
  // The main wholesaler (GFD) first, then by name; items without a supplier last.
  const rank = (g: OrderGroup) =>
    g.supplier === 'Sans fournisseur' ? 2 : /gfd/i.test(g.supplier) ? 0 : 1;
  return [...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || a.supplier.localeCompare(b.supplier, 'fr'),
  );
}

const orderLine = (l: OrderGroup['lines'][number]) =>
  `• ${l.item.name}${l.item.ref ? ` (réf. ${l.item.ref})` : ''} : ${packLabel(l.quantity, l.item)}`;

export function orderMessage(
  group: OrderGroup,
  restaurant = 'Burger House – Saint-Rambert-d’Albon',
) {
  return [
    `Bonjour,`,
    ``,
    `Commande pour ${restaurant} :`,
    ...group.lines.map(orderLine),
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
        g.lines.map(orderLine).join('\n'),
    )
    .join('\n\n');
}

export type CatalogItem = StockItemInput & {
  /** Dishes of the Burger House menu that use this ingredient. */
  usedIn: string[];
};
type Row = [string, string, string, string, string, number, number, string];

/**
 * Ingredients deduced from the Burger House menu (bhouse26.fr): the site lists dishes, not recipes.
 * Nothing is added until the manager selects it, and every guess can be unticked or edited.
 */
export const BURGER_CATALOG: CatalogItem[] = (
  [
    // Viandes
    [
      'Steak haché 150 g',
      'Viandes',
      'pièce',
      'Congélateur',
      'Gfd',
      40,
      150,
      'Burgers Original, Savoyard, Pepper, Indien, Mega, Le BH',
    ],
    [
      'Steak haché cheese (petit)',
      'Viandes',
      'pièce',
      'Congélateur',
      'Gfd',
      40,
      150,
      'Cheese, Double et Triple cheese, Giant, Menu kids, Cheese box',
    ],
    [
      'Viande hachée (tacos, bowls)',
      'Viandes',
      'kg',
      'Chambre froide',
      'Gfd',
      3,
      10,
      'Tacos, Sandwichs, Bowls, Baguette farcie',
    ],
    [
      'Filet de poulet mariné',
      'Viandes',
      'kg',
      'Chambre froide',
      'Gfd',
      3,
      10,
      'Tacos, Sandwichs, Bowls, Riz, Pizzas Indienne et Boursin',
    ],
    [
      'Cordon bleu',
      'Viandes',
      'pièce',
      'Congélateur',
      'Gfd',
      15,
      50,
      'Tacos, Sandwichs, Bowls, Trio',
    ],
    [
      'Poulet pané (Chicken burger)',
      'Viandes',
      'pièce',
      'Congélateur',
      'Gfd',
      15,
      50,
      'Le Chicken burger, Chicken box',
    ],
    [
      'Tenders',
      'Viandes',
      'kg',
      'Congélateur',
      'Gfd',
      2,
      8,
      'Tenders x4, Chicken box, Riz crousty',
    ],
    ['Nuggets', 'Viandes', 'kg', 'Congélateur', 'Gfd', 2, 6, 'Nuggets x5, Menu kids'],
    ['Wings', 'Viandes', 'kg', 'Congélateur', 'Gfd', 2, 6, 'Wings x4, Chicken box'],
    ['Brochettes satay', 'Viandes', 'pièce', 'Congélateur', 'Gfd', 20, 60, 'Satay x5'],
    ['Merguez', 'Viandes', 'kg', 'Chambre froide', 'Gfd', 1, 4, 'Tacos DZ, Pizza Oriental'],
    ['Poisson pané', 'Viandes', 'pièce', 'Congélateur', 'Gfd', 10, 30, 'Burger Fish'],
    ['Galette végétarienne', 'Viandes', 'pièce', 'Congélateur', 'Gfd', 6, 20, 'Burger Veggie'],
    [
      'Bacon / lardons',
      'Viandes',
      'kg',
      'Chambre froide',
      'Gfd',
      1,
      3,
      'Savoyard, Forestier, Pizzas Savoyarde, Royal, Boisée',
    ],
    ['Jambon', 'Viandes', 'kg', 'Chambre froide', 'Gfd', 1, 3, 'Pizzas Reine, Royal'],
    ['Thon', 'Viandes', 'boîte', 'Réserve sèche', 'Gfd', 2, 6, 'Pizza Thuna'],
    ['Saumon fumé', 'Viandes', 'kg', 'Chambre froide', 'Gfd', 0.5, 1.5, 'Pizza Norvégienne'],
    // Pains & pâtes
    ['Pain burger', 'Pains', 'pièce', 'Réserve sèche', 'Gfd', 50, 180, 'Tous les burgers'],
    [
      'Galette tacos',
      'Pains',
      'pièce',
      'Réserve sèche',
      'Gfd',
      30,
      100,
      'Tacos M, L, XL et spéciaux',
    ],
    [
      'Pain sandwich / baguette',
      'Pains',
      'pièce',
      'Réserve sèche',
      'Gfd',
      20,
      60,
      'Sandwichs, Baguette farcie',
    ],
    ['Pâte à pizza (pâton)', 'Pains', 'pièce', 'Congélateur', 'Gfd', 20, 60, 'Toutes les pizzas'],
    // Fromages
    [
      'Cheddar tranches',
      'Fromages',
      'pièce',
      'Chambre froide',
      'Gfd',
      80,
      300,
      'Burgers, Cheese box, Menu kids',
    ],
    ['Mozzarella râpée', 'Fromages', 'kg', 'Chambre froide', 'Gfd', 3, 10, 'Toutes les pizzas'],
    [
      'Raclette',
      'Fromages',
      'kg',
      'Chambre froide',
      'Gfd',
      1,
      3,
      'Savoyard : tacos, burger, sandwich, bowl, pizza',
    ],
    [
      'Boursin',
      'Fromages',
      'pièce',
      'Chambre froide',
      'Gfd',
      4,
      12,
      'Boursin : tacos, sandwich, bowl, riz, pizza',
    ],
    [
      'Chèvre bûche',
      'Fromages',
      'pièce',
      'Chambre froide',
      'Gfd',
      2,
      6,
      'Tacos Chèvre miel, Pizzas 4 fromages, Mielleuse',
    ],
    [
      'Emmental râpé',
      'Fromages',
      'kg',
      'Chambre froide',
      'Gfd',
      1,
      4,
      'Gratinage tacos, Pizza 4 fromages',
    ],
    ['Bleu / gorgonzola', 'Fromages', 'kg', 'Chambre froide', 'Gfd', 0.5, 1.5, 'Pizza 4 fromages'],
    [
      'Crème fraîche',
      'Fromages',
      'L',
      'Frigo',
      'Gfd',
      2,
      6,
      'Pizzas base crème, Forestier, sauce fromagère',
    ],
    // Légumes
    [
      'Salade',
      'Légumes & fruits',
      'pièce',
      'Chambre froide',
      'Carrefour',
      4,
      12,
      'Burgers, Sandwichs, Assiette',
    ],
    [
      'Tomates',
      'Légumes & fruits',
      'kg',
      'Chambre froide',
      'Carrefour',
      2,
      6,
      'Burgers, Sandwichs, Assiette',
    ],
    [
      'Oignons',
      'Légumes & fruits',
      'kg',
      'Réserve sèche',
      'Carrefour',
      2,
      6,
      'Burgers, Pizzas, Sandwichs',
    ],
    [
      'Champignons',
      'Légumes & fruits',
      'kg',
      'Chambre froide',
      'Gfd',
      1,
      4,
      'Forestier, Pizzas Reine, Campione, Boisée',
    ],
    [
      'Pommes de terre / rösti',
      'Légumes & fruits',
      'kg',
      'Congélateur',
      'Gfd',
      2,
      6,
      'Savoyard : tacos, burger, pizza',
    ],
    [
      'Poivrons',
      'Légumes & fruits',
      'kg',
      'Chambre froide',
      'Carrefour',
      1,
      3,
      'Pizzas Oriental, Veggie',
    ],
    ['Olives', 'Légumes & fruits', 'boîte', 'Réserve sèche', 'Gfd', 1, 3, 'Pizzas'],
    ['Cornichons', 'Légumes & fruits', 'boîte', 'Réserve sèche', 'Gfd', 1, 3, 'Burgers'],
    ['Oignons frits', 'Légumes & fruits', 'sachet', 'Réserve sèche', 'Gfd', 1, 3, 'Burgers, Bowls'],
    // Sauces
    [
      'Sauce tomate pizza',
      'Sauces & condiments',
      'L',
      'Réserve sèche',
      'Gfd',
      2,
      6,
      'Pizzas base tomate',
    ],
    ['Sauce fromagère', 'Sauces & condiments', 'L', 'Frigo', 'Gfd', 3, 10, 'Tous les tacos, Bowls'],
    [
      'Sauce curry',
      'Sauces & condiments',
      'L',
      'Réserve sèche',
      'Gfd',
      1,
      3,
      'Indien : tacos, burger, sandwich, bowl, pizza',
    ],
    ['Sauce poivre', 'Sauces & condiments', 'L', 'Réserve sèche', 'Gfd', 1, 2, 'Burger Pepper'],
    [
      'Miel',
      'Sauces & condiments',
      'bouteille',
      'Réserve sèche',
      'Carrefour',
      1,
      3,
      'Tacos Chèvre miel, Pizza Mielleuse',
    ],
    ['Sauce satay', 'Sauces & condiments', 'L', 'Réserve sèche', 'Gfd', 0.5, 2, 'Satays'],
    ['Ketchup', 'Sauces & condiments', 'L', 'Réserve sèche', 'Gfd', 2, 6, 'Sauces au choix'],
    ['Mayonnaise', 'Sauces & condiments', 'L', 'Frigo', 'Gfd', 2, 6, 'Sauces au choix'],
    [
      'Sauce algérienne',
      'Sauces & condiments',
      'L',
      'Réserve sèche',
      'Gfd',
      1,
      4,
      'Sauces au choix, DZ',
    ],
    ['Sauce samouraï', 'Sauces & condiments', 'L', 'Réserve sèche', 'Gfd', 1, 4, 'Sauces au choix'],
    [
      'Sauce barbecue',
      'Sauces & condiments',
      'L',
      'Réserve sèche',
      'Gfd',
      1,
      3,
      'Sauces au choix, Boisée',
    ],
    ['Sauce blanche', 'Sauces & condiments', 'L', 'Frigo', 'Gfd', 1, 4, 'Sauces au choix'],
    ['Sauce burger', 'Sauces & condiments', 'L', 'Frigo', 'Gfd', 1, 4, 'Burgers, Le BH'],
    [
      'Harissa',
      'Sauces & condiments',
      'boîte',
      'Réserve sèche',
      'Gfd',
      1,
      2,
      'Sauces au choix, DZ',
    ],
    // Frites & surgelés
    [
      'Frites',
      'Frites & surgelés',
      'kg',
      'Congélateur',
      'Gfd',
      20,
      60,
      'Frites, tous les menus, Assiette, Tacos',
    ],
    ['Onion rings', 'Frites & surgelés', 'kg', 'Congélateur', 'Gfd', 1, 4, 'Oignon ring x5'],
    ['Chili cheese', 'Frites & surgelés', 'kg', 'Congélateur', 'Gfd', 1, 4, 'Chilly cheese x5'],
    [
      'Sticks mozzarella',
      'Frites & surgelés',
      'kg',
      'Congélateur',
      'Gfd',
      1,
      4,
      'Stick mozza x5, Cheese box',
    ],
    [
      'Sticks camembert',
      'Frites & surgelés',
      'kg',
      'Congélateur',
      'Gfd',
      1,
      4,
      'Stick camembert x5',
    ],
    [
      'Huile de friture',
      'Frites & surgelés',
      'L',
      'Réserve sèche',
      'Gfd',
      10,
      30,
      'Frites et finger food',
    ],
    // Épicerie
    [
      'Riz',
      'Épicerie',
      'kg',
      'Réserve sèche',
      'Gfd',
      3,
      10,
      'Riz Boursin, Forestier, Crousty, Bowls',
    ],
    ['Sel', 'Épicerie', 'kg', 'Réserve sèche', 'Carrefour', 1, 3, 'Frites, cuisine'],
    [
      'Épices / assaisonnement',
      'Épicerie',
      'boîte',
      'Réserve sèche',
      'Gfd',
      1,
      3,
      'Marinade poulet, frites',
    ],
    ['Origan', 'Épicerie', 'boîte', 'Réserve sèche', 'Gfd', 1, 2, 'Pizzas'],
    // Boissons (la carte en ligne ne les détaille pas)
    ['Canettes 33 cl', 'Boissons', 'canette', 'Boissons', 'Carrefour', 24, 96, 'Boisson des menus'],
    ['Eau 50 cl', 'Boissons', 'bouteille', 'Boissons', 'Carrefour', 12, 48, 'Boisson des menus'],
    ['Jus / Capri-Sun enfant', 'Boissons', 'pièce', 'Boissons', 'Carrefour', 10, 30, 'Menu kids'],
    // Desserts (la carte en ligne ne les détaille pas)
    ['Desserts', 'Desserts', 'pièce', 'Frigo', 'Gfd', 6, 24, 'Desserts'],
    ['Surprise / jouet menu kids', 'Desserts', 'pièce', 'Réserve sèche', 'Gfd', 5, 20, 'Menu kids'],
    // Emballages
    ['Boîtes burger', 'Emballages', 'carton', 'Réserve sèche', 'Gfd', 1, 3, 'Burgers'],
    ['Boîtes pizza', 'Emballages', 'carton', 'Réserve sèche', 'Gfd', 1, 3, 'Pizzas'],
    [
      'Papier / alu tacos et sandwich',
      'Emballages',
      'rouleau',
      'Réserve sèche',
      'Gfd',
      2,
      6,
      'Tacos, Sandwichs, Baguette farcie',
    ],
    ['Pots bowl + couvercles', 'Emballages', 'paquet', 'Réserve sèche', 'Gfd', 2, 6, 'Bowls, Riz'],
    ['Boîtes box', 'Emballages', 'paquet', 'Réserve sèche', 'Gfd', 1, 3, 'Chicken box, Cheese box'],
    [
      'Barquettes frites / finger',
      'Emballages',
      'carton',
      'Réserve sèche',
      'Gfd',
      1,
      3,
      'Frites, Finger food',
    ],
    ['Assiettes à emporter', 'Emballages', 'paquet', 'Réserve sèche', 'Gfd', 1, 3, 'Assiette'],
    [
      'Pots à sauce + couvercles',
      'Emballages',
      'paquet',
      'Réserve sèche',
      'Gfd',
      2,
      6,
      'Toutes les commandes',
    ],
    [
      'Sacs kraft à emporter',
      'Emballages',
      'paquet',
      'Réserve sèche',
      'Gfd',
      2,
      6,
      'À emporter, Uber',
    ],
    ['Serviettes', 'Emballages', 'paquet', 'Réserve sèche', 'Gfd', 2, 6, 'Toutes les commandes'],
    [
      'Couverts jetables',
      'Emballages',
      'paquet',
      'Réserve sèche',
      'Gfd',
      1,
      3,
      'Bowls, Riz, Assiette',
    ],
    // Hygiène & entretien
    ['Gants nitrile', 'Hygiène & entretien', 'boîte', 'Cuisine', 'Gfd', 2, 6, 'Cuisine'],
    ['Film alimentaire', 'Hygiène & entretien', 'rouleau', 'Réserve sèche', 'Gfd', 1, 3, 'Cuisine'],
    [
      'Sacs poubelle',
      'Hygiène & entretien',
      'rouleau',
      'Réserve sèche',
      'Carrefour',
      2,
      6,
      'Entretien',
    ],
    [
      'Dégraissant',
      'Hygiène & entretien',
      'bouteille',
      'Réserve sèche',
      'Carrefour',
      1,
      3,
      'Entretien',
    ],
    [
      'Liquide vaisselle',
      'Hygiène & entretien',
      'bouteille',
      'Réserve sèche',
      'Carrefour',
      1,
      3,
      'Entretien',
    ],
    [
      'Essuie-tout',
      'Hygiène & entretien',
      'rouleau',
      'Réserve sèche',
      'Carrefour',
      2,
      8,
      'Cuisine',
    ],
  ] as Row[]
).map(([name, category, unit, zone, supplier, minQuantity, parQuantity, usedIn]) => ({
  name,
  category,
  unit,
  zone,
  supplier,
  minQuantity,
  parQuantity,
  unitCost: 0,
  usedIn: usedIn.split(', '),
}));
