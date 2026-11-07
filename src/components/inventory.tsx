'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  Beef,
  Box,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Copy,
  CupSoda,
  Euro,
  History,
  IceCreamCone,
  Milk,
  Minus,
  Package,
  PackageMinus,
  PackagePlus,
  PackageX,
  Pencil,
  Plus,
  RotateCcw,
  Sandwich,
  Search,
  Send,
  ShoppingCart,
  Snowflake,
  Soup,
  Sparkles,
  SprayCan,
  Carrot,
  Trash2,
  Wheat,
  ListChecks,
  TrendingDown,
  Truck,
  X,
} from 'lucide-react';
import {
  Action,
  CATEGORIES,
  LOSS_REASONS,
  PAYMENTS,
  STOCK_CATEGORIES,
  STOCK_UNITS,
  STOCK_ZONES,
  State,
  StockItem,
  StockItemInput,
  StockMove,
  addDays,
  money,
  today,
} from '@/lib/model';
import {
  BURGER_CATALOG,
  OrderGroup,
  dailyUsage,
  daysLeft,
  expiryLevel,
  formatQty,
  movesValue,
  needsOrder,
  orderGroups,
  orderMessage,
  orderSummary,
  qty,
  roundQty,
  stockLevel,
  stockValue,
  suggestedOrder,
  unitLabel,
} from '@/lib/inventory';
import { Empty, Modal, SegmentedControl } from './ui';
import { parseEuros } from './forms';

type Props = {
  state: State;
  submit: (action: Action) => Promise<boolean>;
  busy: boolean;
  error: string;
  clearError: () => void;
  unavailable: boolean;
  notify: (message: string) => void;
};
type MoveMode = 'out' | 'in' | 'loss' | 'count';
type Sheet =
  | null
  | { type: 'item'; id: string; mode?: MoveMode }
  | { type: 'edit'; id?: string }
  | { type: 'count'; zone?: string }
  | { type: 'receive'; supplier?: string; prefill?: Record<string, number> }
  | { type: 'order' }
  | { type: 'loss' }
  | { type: 'catalog' }
  | { type: 'archive'; id: string }
  | { type: 'bulk-archive' };
type Filter = 'all' | 'order' | 'out' | 'expiry';
type Group = 'category' | 'zone' | 'supplier';

const DRAFT_KEY = 'bh-stock-count-draft';
const DISCRETE_UNITS = new Set([
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
const CATEGORY_ICON: Record<string, typeof Box> = {
  Viandes: Beef,
  Pains: Sandwich,
  Fromages: Milk,
  'Légumes & fruits': Carrot,
  'Sauces & condiments': Soup,
  'Frites & surgelés': Snowflake,
  Boissons: CupSoda,
  Desserts: IceCreamCone,
  Emballages: Package,
  'Hygiène & entretien': SprayCan,
  Épicerie: Wheat,
  Autres: Box,
};
export function StockIcon({ category, size = 19 }: { category: string; size?: number }) {
  const Icon = CATEGORY_ICON[category] ?? Box;
  const tint = Math.max(0, (STOCK_CATEGORIES as readonly string[]).indexOf(category));
  return (
    <span className={`stock-icon tint-${tint}`} aria-hidden="true">
      <Icon size={size} strokeWidth={1.85} />
    </span>
  );
}
export function parseQty(value: string) {
  const v = value.replace(/[\s  ]/g, '').replace(',', '.');
  if (!v) return null;
  if (!/^\d+(\.\d{0,3})?$/.test(v)) return null;
  return roundQty(Number(v));
}
const stepFor = (unit: string) =>
  DISCRETE_UNITS.has(unit) ? 1 : unit === 'g' || unit === 'cl' ? 50 : 0.5;
const chipsFor = (unit: string) =>
  DISCRETE_UNITS.has(unit)
    ? [1, 2, 5, 10]
    : unit === 'g' || unit === 'cl'
      ? [50, 100, 250, 500]
      : [0.5, 1, 2, 5];
const inputQty = (n: number) => String(roundQty(n)).replace('.', ',');
const shortDate = (value: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Paris',
  }).format(new Date(value.length === 10 ? value + 'T12:00:00Z' : value));
const dateTime = (value: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(value));
function ago(value: string | undefined, now = Date.now()) {
  if (!value) return 'jamais';
  const days = Math.floor((now - Date.parse(value)) / 86400000);
  if (days <= 0) return 'aujourd’hui';
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} jours`;
  return `le ${shortDate(value)}`;
}
function expiryText(expiresAt: string, day: string) {
  if (expiresAt < day) return `DLC dépassée (${shortDate(expiresAt)})`;
  if (expiresAt === day) return 'DLC aujourd’hui';
  if (expiresAt === addDays(day, 1)) return 'DLC demain';
  return `DLC le ${shortDate(expiresAt)}`;
}
const actorName = (actor: string) => (actor.includes('@') ? actor.split('@')[0] : actor);
const MOVE_META: Record<StockMove['kind'], { label: string; icon: typeof Box; className: string }> =
  {
    in: { label: 'Réception', icon: PackagePlus, className: 'move-in' },
    out: { label: 'Sortie', icon: PackageMinus, className: 'move-out' },
    loss: { label: 'Perte', icon: PackageX, className: 'move-loss' },
    count: { label: 'Comptage', icon: ClipboardCheck, className: 'move-count' },
  };
async function shareText(text: string, title: string) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
function readDraft(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return v && typeof v === 'object' && v.values ? v.values : {};
  } catch {
    return {};
  }
}
function writeDraft(values: Record<string, string>) {
  try {
    if (Object.keys(values).length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ values }));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

export default function Inventory({
  state,
  submit,
  busy,
  error,
  clearError,
  unavailable,
  notify,
}: Props) {
  const stock = useMemo(() => state.stock ?? [], [state.stock]);
  const moves = useMemo(() => state.stockMoves ?? [], [state.stockMoves]);
  const items = useMemo(() => stock.filter((i) => i.active), [stock]);
  const day = today();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [closing, setClosing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [group, setGroup] = useState<Group>('category');
  const [search, setSearch] = useState('');
  const [managing, setManaging] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [draftCount, setDraftCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setDraftCount(Object.keys(readDraft()).length);
  }, [sheet]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const open = (s: Sheet) => {
    if (timer.current) clearTimeout(timer.current);
    clearError();
    setClosing(false);
    setSheet(s);
  };
  const close = useCallback(() => {
    setClosing(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        setSheet(null);
        setClosing(false);
        clearError();
      },
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220,
    );
  }, [clearError]);
  const run = async (action: Action) => {
    const ok = await submit(action);
    if (ok) close();
    return ok;
  };
  const usage = useMemo(() => {
    const now = new Date();
    return Object.fromEntries(items.map((i) => [i.id, dailyUsage(i, moves, now)]));
  }, [items, moves]);
  const toOrder = items.filter(needsOrder);
  const outOfStock = items.filter((i) => stockLevel(i) === 'out');
  const expiring = items.filter((i) => expiryLevel(i, day));
  const value = stockValue(items);
  const monthStart = day.slice(0, 7) + '-01T00:00:00.000Z';
  const losses = movesValue(moves, ['loss'], monthStart, '9999');
  const received = movesValue(moves, ['in'], monthStart, '9999');
  const lastCount = items.reduce<string | undefined>(
    (a, i) => (i.lastCountedAt && (!a || i.lastCountedAt > a) ? i.lastCountedAt : a),
    undefined,
  );
  const levels = {
    ok: items.filter((i) => ['ok', 'untracked'].includes(stockLevel(i))).length,
    low: items.filter((i) => stockLevel(i) === 'low').length,
    out: outOfStock.length,
  };
  const priorities = items
    .map((item) => {
      const level = stockLevel(item);
      const exp = expiryLevel(item, day);
      const left = daysLeft(item, usage[item.id]);
      let rank = 99;
      let reason = '';
      if (exp === 'expired') [rank, reason] = [0, expiryText(item.expiresAt!, day)];
      else if (level === 'out') [rank, reason] = [1, 'Rupture de stock'];
      else if (exp === 'soon') [rank, reason] = [2, expiryText(item.expiresAt!, day)];
      else if (level === 'low')
        [rank, reason] = [3, `Sous le seuil de ${formatQty(item.minQuantity, item.unit)}`];
      else if (left !== null && left < 2)
        [rank, reason] = [4, left < 1 ? 'Rupture estimée aujourd’hui' : 'Rupture estimée demain'];
      return { item, rank, reason, exp };
    })
    .filter((p) => p.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name, 'fr'));
  const visible = items.filter(
    (i) =>
      (filter === 'all' ||
        (filter === 'order' && needsOrder(i)) ||
        (filter === 'out' && stockLevel(i) === 'out') ||
        (filter === 'expiry' && expiryLevel(i, day))) &&
      `${i.name} ${i.category} ${i.zone} ${i.supplier}`
        .toLocaleLowerCase('fr')
        .includes(search.trim().toLocaleLowerCase('fr')),
  );
  const groups = Object.entries(
    visible.reduce(
      (a, i) => {
        const key = (group === 'supplier' ? i.supplier || 'Sans fournisseur' : i[group]) as string;
        (a[key] ??= []).push(i);
        return a;
      },
      {} as Record<string, StockItem[]>,
    ),
  ).sort(([a], [b]) => {
    const order: readonly string[] =
      group === 'category' ? STOCK_CATEGORIES : group === 'zone' ? STOCK_ZONES : [];
    return order.length ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b, 'fr');
  });
  const rank = (i: StockItem) => ({ out: 0, low: 1, ok: 2, untracked: 3 })[stockLevel(i)];
  const current =
    sheet && 'id' in sheet && sheet.id ? stock.find((i) => i.id === sheet.id) : undefined;
  const sheetProps = { busy, error, unavailable };

  return (
    <>
      {!items.length ? (
        <section className="panel stock-onboarding">
          <div className="onboarding-badge">
            <Sparkles size={16} /> Nouveau
          </div>
          <h2>Votre inventaire, prêt en 3 minutes.</h2>
          <p>
            Vos produits sont déjà prêts, d’après votre carte en ligne. Comptez une première fois,
            et l’app s’occupe du reste : alertes de rupture, DLC, liste de courses par fournisseur
            et valeur du stock.
          </p>
          <ol className="onboarding-steps">
            <li>
              <span>1</span>
              <div>
                <strong>Ajoutez vos produits</strong>
                <small>Préparés d’après votre carte : décochez les erreurs.</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Faites un premier comptage</strong>
                <small>Zone par zone, avec des boutons + et −.</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Laissez l’app vous guider</strong>
                <small>Elle calcule quoi commander, et chez qui.</small>
              </div>
            </li>
          </ol>
          <div className="onboarding-actions">
            <button
              className="button button-primary"
              disabled={unavailable}
              onClick={() => open({ type: 'catalog' })}
            >
              <Sparkles size={17} />
              Voir les produits de ma carte
            </button>
            <button
              className="button button-secondary"
              disabled={unavailable}
              onClick={() => open({ type: 'edit' })}
            >
              <Plus size={17} />
              Créer un article
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="stock-hero">
            <div className="stock-hero-main">
              <span className="stock-hero-kicker">
                <span className="mini-icon">
                  <Package size={18} />
                </span>
                Valeur du stock
              </span>
              <div className="hero-amount">
                {money(value).split(',')[0]}
                <span>,{money(value).split(',')[1]}</span>
              </div>
              <p>
                {items.length} article{items.length > 1 ? 's' : ''} suivi
                {items.length > 1 ? 's' : ''} · dernier comptage {ago(lastCount)}
              </p>
              <div
                className="stock-health"
                role="img"
                aria-label={`${levels.ok} articles en stock, ${levels.low} sous le seuil, ${levels.out} en rupture`}
              >
                {levels.ok > 0 && <i className="health-ok" style={{ flex: levels.ok }} />}
                {levels.low > 0 && <i className="health-low" style={{ flex: levels.low }} />}
                {levels.out > 0 && <i className="health-out" style={{ flex: levels.out }} />}
              </div>
              <div className="stock-health-legend">
                <span>
                  <i className="health-ok" /> {levels.ok} OK
                </span>
                <span>
                  <i className="health-low" /> {levels.low} bas
                </span>
                <span>
                  <i className="health-out" /> {levels.out} rupture
                </span>
              </div>
            </div>
            <div className="stock-hero-side">
              <button
                className={`hero-stat ${toOrder.length ? 'is-warning' : ''}`}
                onClick={() => setFilter('order')}
              >
                <ShoppingCart size={18} />
                <strong>{toOrder.length}</strong>
                <span>à commander</span>
              </button>
              <button
                className={`hero-stat ${outOfStock.length ? 'is-danger' : ''}`}
                onClick={() => setFilter('out')}
              >
                <PackageX size={18} />
                <strong>{outOfStock.length}</strong>
                <span>en rupture</span>
              </button>
              <button
                className={`hero-stat ${expiring.length ? 'is-warning' : ''}`}
                onClick={() => setFilter('expiry')}
              >
                <CalendarClock size={18} />
                <strong>{expiring.length}</strong>
                <span>DLC à surveiller</span>
              </button>
              <button
                className="hero-cta"
                disabled={unavailable}
                onClick={() => open({ type: 'count' })}
              >
                <ClipboardCheck size={18} />
                {draftCount ? `Reprendre le comptage (${draftCount})` : 'Lancer un comptage'}
                <ChevronRight size={16} />
              </button>
            </div>
          </section>

          <div className="stock-actions">
            <button disabled={unavailable} onClick={() => open({ type: 'receive' })}>
              <span className="action-in">
                <Truck size={22} />
              </span>
              <strong>Réception</strong>
              <small>Une livraison arrive</small>
            </button>
            <button disabled={unavailable} onClick={() => open({ type: 'count' })}>
              <span className="action-count">
                <ClipboardCheck size={22} />
              </span>
              <strong>Comptage</strong>
              <small>{draftCount ? `${draftCount} déjà comptés` : 'Faire l’inventaire'}</small>
            </button>
            <button disabled={unavailable} onClick={() => open({ type: 'loss' })}>
              <span className="action-loss">
                <PackageX size={22} />
              </span>
              <strong>Perte</strong>
              <small>Périmé, abîmé…</small>
            </button>
            <button onClick={() => open({ type: 'order' })}>
              <span className="action-order">
                <ShoppingCart size={22} />
                {!!toOrder.length && <i>{toOrder.length}</i>}
              </span>
              <strong>Commande</strong>
              <small>{toOrder.length ? 'Liste prête' : 'Rien à commander'}</small>
            </button>
          </div>

          <div className="metrics-grid stock-metrics">
            <div className="metric expense">
              <div>
                <span>Pertes du mois</span>
                <i>
                  <TrendingDown size={17} />
                </i>
              </div>
              <strong>{money(losses)}</strong>
              <p>Valeur des produits jetés ou offerts</p>
            </div>
            <div className="metric balance">
              <div>
                <span>Réceptions du mois</span>
                <i>
                  <Truck size={17} />
                </i>
              </div>
              <strong>{money(received)}</strong>
              <p>Marchandises entrées en stock</p>
            </div>
            <div className="metric hours">
              <div>
                <span>Commande estimée</span>
                <i>
                  <Euro size={17} />
                </i>
              </div>
              <strong>{money(orderGroups(items).reduce((a, g) => a + g.total, 0))}</strong>
              <p>Pour revenir au stock idéal</p>
            </div>
          </div>

          {!!priorities.length && (
            <section className="panel priority-panel">
              <header className="panel-header">
                <div>
                  <h2>À traiter maintenant</h2>
                  <p>Classé par urgence. Touchez un article pour agir.</p>
                </div>
                <span className="priority-count">{priorities.length}</span>
              </header>
              <div>
                {priorities.slice(0, 6).map(({ item, reason, rank, exp }) => (
                  <div className="priority-row" key={item.id}>
                    <button
                      className="priority-main"
                      onClick={() =>
                        open({ type: 'item', id: item.id, mode: exp === 'expired' ? 'loss' : 'in' })
                      }
                    >
                      <StockIcon category={item.category} />
                      <span>
                        <strong>{item.name}</strong>
                        <small className={rank <= 1 ? 'text-danger' : 'text-warning'}>
                          {rank <= 1 ? (
                            <CircleAlert size={12} />
                          ) : rank === 2 ? (
                            <CalendarClock size={12} />
                          ) : (
                            <TrendingDown size={12} />
                          )}
                          {reason}
                        </small>
                      </span>
                      <em>{formatQty(Math.max(0, item.quantity), item.unit)}</em>
                    </button>
                    {exp === 'expired' ? (
                      <button
                        className="priority-action danger"
                        disabled={unavailable}
                        onClick={() => open({ type: 'item', id: item.id, mode: 'loss' })}
                      >
                        Jeter
                      </button>
                    ) : (
                      <button className="priority-action" onClick={() => open({ type: 'order' })}>
                        Commander
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {priorities.length > 6 && (
                <button className="rail-link" onClick={() => setFilter('order')}>
                  Voir les {priorities.length} alertes
                  <ChevronRight size={15} />
                </button>
              )}
            </section>
          )}

          <section className="panel stock-panel">
            <div className="ledger-tools stock-tools">
              <div className="filter-tabs">
                {(
                  [
                    ['all', 'Tout', items.length],
                    ['order', 'À commander', toOrder.length],
                    ['out', 'Rupture', outOfStock.length],
                    ['expiry', 'DLC', expiring.length],
                  ] as const
                ).map(([v, l, n]) => (
                  <button
                    key={v}
                    className={filter === v ? 'active' : ''}
                    onClick={() => setFilter(v)}
                  >
                    {l}
                    {v !== 'all' && n > 0 && <span className="filter-count">{n}</span>}
                  </button>
                ))}
              </div>
              <div className="ledger-search">
                <Search size={17} />
                <input
                  aria-label="Rechercher un article"
                  placeholder="Rechercher un produit…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button aria-label="Effacer la recherche" onClick={() => setSearch('')}>
                    <X size={14} />
                  </button>
                )}
              </div>
              <select
                className="category-filter"
                aria-label="Regrouper par"
                value={group}
                onChange={(e) => setGroup(e.target.value as Group)}
              >
                <option value="category">Par catégorie</option>
                <option value="zone">Par zone de stockage</option>
                <option value="supplier">Par fournisseur</option>
              </select>
              <button
                className={`button stock-manage ${managing ? 'button-dark' : 'button-secondary'}`}
                disabled={unavailable}
                aria-pressed={managing}
                onClick={() => {
                  setManaging(!managing);
                  setPicked(new Set());
                }}
              >
                <ListChecks size={17} />
                <span>{managing ? 'Terminé' : 'Sélectionner'}</span>
              </button>
              <button
                className="button button-soft stock-add"
                disabled={unavailable}
                onClick={() => open({ type: 'edit' })}
              >
                <Plus size={17} />
                <span>Article</span>
              </button>
            </div>
            {managing && (
              <div className="stock-manage-bar">
                <span>
                  {picked.size
                    ? `${picked.size} sélectionné${picked.size > 1 ? 's' : ''}`
                    : 'Touchez les articles à retirer'}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    setPicked(
                      picked.size === visible.length
                        ? new Set()
                        : new Set(visible.map((i) => i.id)),
                    )
                  }
                >
                  {picked.size === visible.length && visible.length ? 'Aucun' : 'Tout'}
                </button>
                <button
                  className="button button-danger"
                  disabled={!picked.size || unavailable}
                  onClick={() => open({ type: 'bulk-archive' })}
                >
                  <Trash2 size={15} />
                  Supprimer
                </button>
              </div>
            )}
            {groups.length ? (
              groups.map(([name, list]) => (
                <div className="stock-group" key={name}>
                  <div className="stock-group-head">
                    <span>{name}</span>
                    <small>
                      {list.length} · {money(stockValue(list), false)}
                    </small>
                  </div>
                  {list
                    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'))
                    .map((item) => (
                      <StockRow
                        key={item.id}
                        item={item}
                        day={day}
                        usage={usage[item.id]}
                        picked={managing ? picked.has(item.id) : undefined}
                        onClick={() =>
                          managing ? togglePick(item.id) : open({ type: 'item', id: item.id })
                        }
                      />
                    ))}
                </div>
              ))
            ) : (
              <Empty
                title={search ? 'Aucun produit trouvé' : 'Tout va bien ici'}
                body={
                  search
                    ? 'Essayez un autre nom, une catégorie ou un fournisseur.'
                    : 'Aucun article ne correspond à ce filtre.'
                }
                action={
                  <button
                    className="text-button"
                    onClick={() => {
                      setFilter('all');
                      setSearch('');
                    }}
                  >
                    Afficher tout l’inventaire
                  </button>
                }
              />
            )}
            <div className="ledger-footer">
              <span>
                {visible.length} article{visible.length > 1 ? 's' : ''}
              </span>
              <button
                className="text-button"
                disabled={unavailable}
                onClick={() => open({ type: 'catalog' })}
              >
                <Sparkles size={14} />
                Produits de ma carte
              </button>
            </div>
          </section>

          <section className="panel moves-panel">
            <header className="panel-header">
              <div>
                <h2>Derniers mouvements</h2>
                <p>Réceptions, sorties, pertes et comptages.</p>
              </div>
              <History size={19} className="muted" />
            </header>
            {moves.length ? (
              <div>
                {moves.slice(0, 10).map((m) => (
                  <MoveRow
                    key={m.id}
                    move={m}
                    item={stock.find((i) => i.id === m.itemId)}
                    onClick={() => {
                      const it = stock.find((i) => i.id === m.itemId);
                      if (it?.active) open({ type: 'item', id: it.id });
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="inline-empty">Les mouvements de stock apparaîtront ici.</div>
            )}
          </section>
          <p className="footnote">
            Le stock théorique se met à jour à chaque réception, sortie, perte et comptage.
            L’autonomie est estimée sur la consommation des 14 derniers jours. Un comptage régulier
            garde les chiffres justes.
          </p>
        </>
      )}

      {/* Sheets live at the document root: the animated page content would trap fixed positioning. */}
      {sheet &&
        createPortal(
          <>
            {sheet?.type === 'item' && current && (
              <Modal
                title={current.name}
                subtitle={`${current.category} · ${current.zone}`}
                onClose={close}
                closing={closing}
              >
                <ItemSheet
                  key={current.id + (sheet.mode ?? '')}
                  item={current}
                  moves={moves.filter((m) => m.itemId === current.id)}
                  usage={usage[current.id] ?? 0}
                  day={day}
                  initialMode={sheet.mode}
                  onSubmit={run}
                  onEdit={() => open({ type: 'edit', id: current.id })}
                  onArchive={() => open({ type: 'archive', id: current.id })}
                  {...sheetProps}
                />
              </Modal>
            )}
            {sheet?.type === 'edit' && (
              <Modal
                title={current ? 'Modifier l’article' : 'Nouvel article'}
                subtitle="Nom, unité, seuils et fournisseur."
                onClose={close}
                closing={closing}
              >
                <ItemForm
                  item={current}
                  suppliers={suppliersOf(stock)}
                  onSubmit={async (action) => {
                    const ok = await submit(action);
                    if (ok) {
                      if (current) open({ type: 'item', id: current.id });
                      else close();
                    }
                    return ok;
                  }}
                  {...sheetProps}
                />
              </Modal>
            )}
            {sheet?.type === 'count' && (
              <Modal
                title="Comptage d’inventaire"
                subtitle="Comptez ce qui est réellement en stock. Le brouillon est conservé sur ce téléphone."
                onClose={close}
                closing={closing}
                wide
              >
                <CountSheet items={items} onSubmit={run} {...sheetProps} />
              </Modal>
            )}
            {sheet?.type === 'receive' && (
              <Modal
                title="Réception de livraison"
                subtitle="Les quantités entrent en stock, la dépense peut être créée automatiquement."
                onClose={close}
                closing={closing}
                wide
              >
                <ReceiveSheet
                  items={items}
                  suppliers={suppliersOf(stock)}
                  supplier={sheet.supplier}
                  prefill={sheet.prefill}
                  onSubmit={run}
                  {...sheetProps}
                />
              </Modal>
            )}
            {sheet?.type === 'order' && (
              <Modal
                title="Liste de commande"
                subtitle="Calculée pour revenir au stock idéal, fournisseur par fournisseur."
                onClose={close}
                closing={closing}
                wide
              >
                <OrderSheet
                  items={items}
                  notify={notify}
                  unavailable={unavailable}
                  onReceive={(supplier, prefill) => open({ type: 'receive', supplier, prefill })}
                />
              </Modal>
            )}
            {sheet?.type === 'loss' && (
              <Modal
                title="Déclarer une perte"
                subtitle="Produit périmé, abîmé, offert ou repas du personnel."
                onClose={close}
                closing={closing}
              >
                <LossSheet items={items} onSubmit={run} {...sheetProps} />
              </Modal>
            )}
            {sheet?.type === 'catalog' && (
              <Modal
                title="Les produits de votre carte"
                subtitle="Ingrédients déduits de votre menu. Décochez ce qui est faux."
                onClose={close}
                closing={closing}
                wide
              >
                <CatalogSheet existing={items} onSubmit={run} {...sheetProps} />
              </Modal>
            )}
            {sheet?.type === 'bulk-archive' && (
              <Modal
                title={`Supprimer ${picked.size} article${picked.size > 1 ? 's' : ''} ?`}
                subtitle="Ils disparaissent de l’inventaire, des comptages et des commandes."
                onClose={close}
                closing={closing}
              >
                <div className="confirm-content">
                  <p className="bulk-names">
                    {stock
                      .filter((i) => picked.has(i.id))
                      .map((i) => i.name)
                      .join(' · ')}
                  </p>
                  <p>
                    L’historique de leurs mouvements est conservé. Vous pourrez les recréer depuis
                    le catalogue ou avec « Article ».
                  </p>
                  {error && <p className="form-error">{error}</p>}
                  <button
                    className="button button-danger full"
                    disabled={busy || unavailable || !picked.size}
                    onClick={async () => {
                      const ok = await run({ type: 'stock.items.archive', ids: [...picked] });
                      if (ok) {
                        setPicked(new Set());
                        setManaging(false);
                      }
                    }}
                  >
                    <Trash2 size={17} />
                    {busy ? 'Suppression…' : 'Confirmer la suppression'}
                  </button>
                </div>
              </Modal>
            )}
            {sheet?.type === 'archive' && current && (
              <Modal
                title="Supprimer cet article ?"
                subtitle={current.name}
                onClose={close}
                closing={closing}
              >
                <div className="confirm-content">
                  <p>
                    L’article disparaît de l’inventaire et des commandes. Son historique de
                    mouvements est conservé.
                  </p>
                  {error && <p className="form-error">{error}</p>}
                  <button
                    className="button button-danger full"
                    disabled={busy || unavailable}
                    onClick={() => void run({ type: 'stock.item.archive', id: current.id })}
                  >
                    <Trash2 size={17} />
                    {busy ? 'Suppression…' : 'Confirmer la suppression'}
                  </button>
                </div>
              </Modal>
            )}
          </>,
          document.body,
        )}
    </>
  );
}

function suppliersOf(stock: StockItem[]) {
  return [
    ...new Set([
      'Gfd',
      'Carrefour',
      'Metro',
      'Promocash',
      ...stock.map((i) => i.supplier).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b, 'fr'));
}

function Gauge({ item }: { item: StockItem }) {
  const scale = Math.max(item.parQuantity, item.minQuantity * 2, item.quantity, 1);
  const level = stockLevel(item);
  return (
    <span className={`stock-gauge gauge-${level}`} aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(1, item.quantity / scale)) * 100}%` }} />
      {item.minQuantity > 0 && <b style={{ left: `${(item.minQuantity / scale) * 100}%` }} />}
    </span>
  );
}

function StatusBadge({ item, day }: { item: StockItem; day: string }) {
  const level = stockLevel(item);
  const exp = expiryLevel(item, day);
  if (exp === 'expired') return <span className="stock-badge badge-out">DLC dépassée</span>;
  if (level === 'out') return <span className="stock-badge badge-out">Rupture</span>;
  if (level === 'low') return <span className="stock-badge badge-low">À commander</span>;
  if (exp === 'soon') return <span className="stock-badge badge-low">DLC proche</span>;
  return null;
}

function StockRow({
  item,
  day,
  usage,
  onClick,
  picked,
}: {
  item: StockItem;
  day: string;
  usage: number;
  onClick: () => void;
  /** Defined in selection mode. */
  picked?: boolean;
}) {
  const left = daysLeft(item, usage);
  const selecting = picked !== undefined;
  return (
    <button
      className={`stock-row ${selecting ? 'is-selecting' : ''} ${picked ? 'is-picked' : ''}`}
      onClick={onClick}
      aria-pressed={selecting ? picked : undefined}
    >
      {selecting && (
        <span className="pick-circle" aria-hidden="true">
          {picked && <Check size={14} strokeWidth={3} />}
        </span>
      )}
      <StockIcon category={item.category} />
      <span className="stock-name">
        <strong>{item.name}</strong>
        <small>
          {[
            item.supplier,
            left !== null && item.quantity > 0
              ? left < 1
                ? 'moins d’un jour'
                : `≈ ${Math.floor(left)} j d’autonomie`
              : '',
            item.expiresAt && item.quantity > 0 ? expiryText(item.expiresAt, day) : '',
          ]
            .filter(Boolean)
            .join(' · ') || item.zone}
        </small>
        <Gauge item={item} />
      </span>
      <span className="stock-qty">
        <strong>{qty(Math.max(0, item.quantity))}</strong>
        <small>{unitLabel(item.unit, item.quantity)}</small>
        <StatusBadge item={item} day={day} />
      </span>
      <ChevronRight size={15} className="transaction-arrow" />
    </button>
  );
}

function MoveRow({
  move: m,
  item,
  onClick,
}: {
  move: StockMove;
  item?: StockItem;
  onClick?: () => void;
}) {
  const meta = MOVE_META[m.kind];
  const Icon = meta.icon;
  return (
    <button className="move-row" onClick={onClick} type="button">
      <span className={`move-icon ${meta.className}`}>
        <Icon size={18} />
      </span>
      <span className="move-name">
        <strong>{item?.name ?? 'Article supprimé'}</strong>
        <small>
          {meta.label}
          {m.reason && m.reason !== meta.label ? ` · ${m.reason}` : ''} · {dateTime(m.at)} ·{' '}
          {actorName(m.actor)}
        </small>
      </span>
      <span className={`move-delta ${m.delta > 0 ? 'positive' : 'negative'}`}>
        {m.delta > 0 ? '+' : '−'}
        {formatQty(Math.abs(m.delta), item?.unit ?? '')}
        {m.unitCost > 0 && <small>{money(Math.round(Math.abs(m.delta) * m.unitCost))}</small>}
      </span>
    </button>
  );
}

function Stepper({
  value,
  onChange,
  unit,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  unit: string;
  label: string;
  autoFocus?: boolean;
}) {
  const step = stepFor(unit);
  const n = parseQty(value) ?? 0;
  return (
    <div className="stepper">
      <button
        type="button"
        aria-label={`Retirer ${step}`}
        onClick={() => onChange(inputQty(Math.max(0, roundQty(n - step))))}
      >
        <Minus size={20} />
      </button>
      <label>
        <input
          aria-label={label}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          placeholder="0"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(e.target.value)}
        />
        <small>{unitLabel(unit, n)}</small>
      </label>
      <button
        type="button"
        aria-label={`Ajouter ${step}`}
        onClick={() => onChange(inputQty(roundQty(n + step)))}
      >
        <Plus size={20} />
      </button>
    </div>
  );
}

function ItemSheet({
  item,
  moves,
  usage,
  day,
  initialMode,
  onSubmit,
  onEdit,
  onArchive,
  busy,
  error,
  unavailable,
}: {
  item: StockItem;
  moves: StockMove[];
  usage: number;
  day: string;
  initialMode?: MoveMode;
  onSubmit: (a: Action) => Promise<boolean>;
  onEdit: () => void;
  onArchive: () => void;
  busy: boolean;
  error: string;
  unavailable: boolean;
}) {
  const [mode, setMode] = useState<MoveMode>(initialMode ?? 'out');
  const [value, setValue] = useState(
    initialMode === 'count' ? inputQty(Math.max(0, item.quantity)) : '',
  );
  const [reason, setReason] = useState<string>('');
  const [cost, setCost] = useState(
    item.unitCost ? (item.unitCost / 100).toFixed(2).replace('.', ',') : '',
  );
  const [expiresAt, setExpiresAt] = useState('');
  const [localError, setLocalError] = useState('');
  const n = parseQty(value);
  const after =
    n === null
      ? null
      : mode === 'count'
        ? n
        : mode === 'in'
          ? roundQty(item.quantity + n)
          : roundQty(item.quantity - n);
  const left = daysLeft(item, usage);
  const level = stockLevel(item);
  const switchMode = (m: MoveMode) => {
    setMode(m);
    setLocalError('');
    setValue(m === 'count' ? inputQty(Math.max(0, item.quantity)) : '');
  };
  return (
    <div className="item-sheet">
      <div className={`item-hero level-${level}`}>
        <StockIcon category={item.category} size={24} />
        <div>
          <strong>
            {qty(Math.max(0, item.quantity))}
            <span>{unitLabel(item.unit, item.quantity)}</span>
          </strong>
          <small>
            {level === 'out'
              ? 'Rupture de stock'
              : level === 'low'
                ? 'Sous le seuil d’alerte'
                : level === 'untracked'
                  ? 'Aucun seuil défini'
                  : 'Stock suffisant'}
          </small>
        </div>
        <StatusBadge item={item} day={day} />
      </div>
      <Gauge item={item} />
      <div className="gauge-legend">
        <span>0</span>
        {item.minQuantity > 0 && <span>Alerte {formatQty(item.minQuantity, item.unit)}</span>}
        {item.parQuantity > 0 && <span>Idéal {formatQty(item.parQuantity, item.unit)}</span>}
      </div>
      <dl className="item-stats">
        <div>
          <dt>Valeur</dt>
          <dd>
            {item.unitCost ? money(Math.round(Math.max(0, item.quantity) * item.unitCost)) : '—'}
          </dd>
        </div>
        <div>
          <dt>Prix unitaire</dt>
          <dd>{item.unitCost ? money(item.unitCost) : 'À renseigner'}</dd>
        </div>
        <div>
          <dt>Conso. / jour</dt>
          <dd>{usage ? formatQty(Math.round(usage * 10) / 10, item.unit) : '—'}</dd>
        </div>
        <div>
          <dt>Autonomie</dt>
          <dd>
            {left === null
              ? '—'
              : left < 1
                ? '< 1 jour'
                : `≈ ${Math.floor(left)} jour${left >= 2 ? 's' : ''}`}
          </dd>
        </div>
        <div>
          <dt>DLC</dt>
          <dd>{item.expiresAt ? expiryText(item.expiresAt, day) : '—'}</dd>
        </div>
        <div>
          <dt>Dernier comptage</dt>
          <dd>{ago(item.lastCountedAt)}</dd>
        </div>
      </dl>

      <form
        className="form move-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setLocalError('');
          if (n === null || (mode !== 'count' && n <= 0)) {
            setLocalError('Indiquez une quantité valide. Exemple : 2 ou 1,5');
            return;
          }
          if (mode === 'loss' && !reason) {
            setLocalError('Choisissez le motif de la perte.');
            return;
          }
          if (mode === 'count') {
            await onSubmit({ type: 'stock.count', lines: [{ itemId: item.id, quantity: n }] });
            return;
          }
          const unitCost = parseEuros(cost);
          if (mode === 'in' && unitCost === null) {
            setLocalError('Prix unitaire mal saisi. Exemple : 4,90');
            return;
          }
          await onSubmit({
            type: 'stock.move',
            itemId: item.id,
            kind: mode,
            quantity: n,
            reason: mode === 'loss' ? reason : undefined,
            unitCost: mode === 'in' && unitCost ? unitCost : undefined,
            expiresAt: mode === 'in' && expiresAt ? expiresAt : undefined,
          });
        }}
      >
        <SegmentedControl
          className="move-switch"
          options={
            [
              { value: 'out', label: 'Sortie' },
              { value: 'in', label: 'Entrée' },
              { value: 'loss', label: 'Perte' },
              { value: 'count', label: 'Compter' },
            ] as const
          }
          value={mode}
          onChange={switchMode}
          label="Type de mouvement"
        />
        <Stepper
          value={value}
          onChange={setValue}
          unit={item.unit}
          label={mode === 'count' ? 'Quantité comptée' : 'Quantité'}
        />
        {mode !== 'count' && (
          <div className="quick-chips">
            {chipsFor(item.unit).map((c) => (
              <button
                type="button"
                key={c}
                className={n === c ? 'active' : ''}
                onClick={() => setValue(inputQty(c))}
              >
                {qty(c)}
              </button>
            ))}
            {mode !== 'in' && item.quantity > 0 && (
              <button
                type="button"
                className={n === item.quantity ? 'active' : ''}
                onClick={() => setValue(inputQty(item.quantity))}
              >
                Tout
              </button>
            )}
          </div>
        )}
        {mode === 'loss' && (
          <div className="reason-chips" role="group" aria-label="Motif de la perte">
            {LOSS_REASONS.map((r) => (
              <button
                type="button"
                key={r}
                aria-pressed={reason === r}
                className={reason === r ? 'active' : ''}
                onClick={() => setReason(r)}
              >
                {r}
              </button>
            ))}
          </div>
        )}
        {mode === 'in' && (
          <div className="form-grid">
            <label>
              Prix unitaire (€ / {item.unit})
              <input
                inputMode="decimal"
                placeholder="0,00"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </label>
            <label>
              DLC du lot (facultatif)
              <input
                type="date"
                min={day}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </label>
          </div>
        )}
        {after !== null && (n ?? 0) >= 0 && value !== '' && (
          <p className={`move-preview ${after < 0 ? 'is-invalid' : ''}`}>
            Stock après validation :{' '}
            <strong>{after < 0 ? 'insuffisant' : formatQty(after, item.unit)}</strong>
            {mode === 'count' && after !== item.quantity && (
              <em>
                {' '}
                (écart {after - item.quantity > 0 ? '+' : '−'}
                {formatQty(Math.abs(roundQty(after - item.quantity)), item.unit)})
              </em>
            )}
          </p>
        )}
        {(localError || error) && (
          <p className="form-error" role="alert">
            {localError || error}
          </p>
        )}
        <button className="button button-primary full" disabled={busy || unavailable}>
          {busy
            ? 'Enregistrement…'
            : mode === 'out'
              ? 'Enregistrer la sortie'
              : mode === 'in'
                ? 'Ajouter au stock'
                : mode === 'loss'
                  ? 'Déclarer la perte'
                  : 'Valider le comptage'}
          <Check size={18} />
        </button>
      </form>

      <div className="item-history">
        <h4>Historique</h4>
        {moves.length ? (
          moves.slice(0, 12).map((m) => <MoveRow key={m.id} move={m} item={item} />)
        ) : (
          <p className="field-help">Aucun mouvement pour le moment.</p>
        )}
      </div>
      <div className="item-footer">
        <button className="button button-secondary" disabled={unavailable} onClick={onEdit}>
          <Pencil size={16} />
          Modifier
        </button>
        <button
          className="button button-secondary danger-text"
          disabled={unavailable}
          onClick={onArchive}
        >
          <Archive size={16} />
          Supprimer
        </button>
      </div>
    </div>
  );
}

function ItemForm({
  item,
  suppliers,
  onSubmit,
  busy,
  error,
  unavailable,
}: {
  item?: StockItem;
  suppliers: string[];
  onSubmit: (a: Action) => Promise<boolean>;
  busy: boolean;
  error: string;
  unavailable: boolean;
}) {
  const [unit, setUnit] = useState(item?.unit ?? 'pièce');
  const [localError, setLocalError] = useState('');
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError('');
        const f = new FormData(e.currentTarget);
        const num = (k: string) => parseQty(String(f.get(k) ?? '') || '0');
        const unitCost = parseEuros(String(f.get('unitCost') ?? ''));
        const [min, par, initial] = [num('minQuantity'), num('parQuantity'), num('initial')];
        if (min === null || par === null || initial === null || unitCost === null) {
          setLocalError('Un nombre est mal saisi. Utilisez par exemple 2 ou 1,5.');
          return;
        }
        const input: StockItemInput = {
          name: String(f.get('name') ?? ''),
          category: String(f.get('category')),
          unit,
          zone: String(f.get('zone')),
          supplier: String(f.get('supplier') ?? ''),
          minQuantity: min,
          parQuantity: par,
          unitCost,
          expiresAt: String(f.get('expiresAt') ?? '') || undefined,
        };
        await onSubmit(
          item
            ? { type: 'stock.item.save', id: item.id, item: input }
            : { type: 'stock.item.save', item: input, initialQuantity: initial },
        );
      }}
    >
      <label>
        Nom du produit
        <input
          name="name"
          defaultValue={item?.name}
          placeholder="Ex. Steak haché 150 g"
          maxLength={80}
          required
        />
      </label>
      <div className="form-grid">
        <label>
          Catégorie
          <select name="category" defaultValue={item?.category ?? 'Viandes'}>
            {STOCK_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Unité de comptage
          <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {STOCK_UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-grid">
        <label>
          Zone de stockage
          <select name="zone" defaultValue={item?.zone ?? 'Chambre froide'}>
            {STOCK_ZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <label>
          Fournisseur
          <input
            name="supplier"
            list="stock-suppliers"
            defaultValue={item?.supplier}
            placeholder="Ex. Gfd"
            maxLength={60}
          />
          <datalist id="stock-suppliers">
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="form-grid">
        <label>
          Seuil d’alerte ({unit})
          <input
            name="minQuantity"
            inputMode="decimal"
            defaultValue={item ? inputQty(item.minQuantity) : ''}
            placeholder="Ex. 20"
          />
        </label>
        <label>
          Stock idéal ({unit})
          <input
            name="parQuantity"
            inputMode="decimal"
            defaultValue={item ? inputQty(item.parQuantity) : ''}
            placeholder="Ex. 80"
          />
        </label>
      </div>
      <p className="field-help">
        Sous le seuil d’alerte, le produit passe « à commander ». La commande proposée remonte au
        stock idéal.
      </p>
      <div className="form-grid">
        <label>
          Prix d’achat (€ / {unit})
          <input
            name="unitCost"
            inputMode="decimal"
            defaultValue={item?.unitCost ? (item.unitCost / 100).toFixed(2).replace('.', ',') : ''}
            placeholder="0,00"
          />
        </label>
        {item ? (
          <label>
            DLC la plus proche
            <input name="expiresAt" type="date" defaultValue={item.expiresAt} />
          </label>
        ) : (
          <label>
            Stock actuel ({unit})
            <input name="initial" inputMode="decimal" placeholder="0" />
          </label>
        )}
      </div>
      {!item && (
        <label>
          DLC la plus proche (facultatif)
          <input name="expiresAt" type="date" />
        </label>
      )}
      {(localError || error) && (
        <p className="form-error" role="alert">
          {localError || error}
        </p>
      )}
      <button className="button button-primary full" disabled={busy || unavailable}>
        {busy
          ? 'Enregistrement…'
          : item
            ? 'Enregistrer les modifications'
            : 'Ajouter à l’inventaire'}
        <Check size={18} />
      </button>
    </form>
  );
}

function CountSheet({
  items,
  onSubmit,
  busy,
  error,
  unavailable,
}: {
  items: StockItem[];
  onSubmit: (a: Action) => Promise<boolean>;
  busy: boolean;
  error: string;
  unavailable: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const draft = readDraft();
    return Object.fromEntries(
      Object.entries(draft).filter(([id]) => items.some((i) => i.id === id)),
    );
  });
  const [zone, setZone] = useState('all');
  const [search, setSearch] = useState('');
  const [blind, setBlind] = useState(false);
  const [localError, setLocalError] = useState('');
  useEffect(() => writeDraft(values), [values]);
  const zones = STOCK_ZONES.filter((z) => items.some((i) => i.zone === z));
  const set = (id: string, v: string) => setValues((p) => ({ ...p, [id]: v }));
  const counted = Object.keys(values).filter((id) => values[id] !== '');
  const invalid = counted.filter((id) => parseQty(values[id]) === null);
  const variance = counted.reduce((a, id) => {
    const item = items.find((i) => i.id === id);
    const n = parseQty(values[id]);
    return item && n !== null ? a + Math.round((n - item.quantity) * item.unitCost) : a;
  }, 0);
  const list = items
    .filter(
      (i) =>
        (zone === 'all' || i.zone === zone) &&
        i.name.toLocaleLowerCase('fr').includes(search.trim().toLocaleLowerCase('fr')),
    )
    .sort(
      (a, b) =>
        STOCK_ZONES.indexOf(a.zone as (typeof STOCK_ZONES)[number]) -
          STOCK_ZONES.indexOf(b.zone as (typeof STOCK_ZONES)[number]) ||
        a.name.localeCompare(b.name, 'fr'),
    );
  const zoneDone = (z: string) =>
    items
      .filter((i) => i.zone === z)
      .every((i) => values[i.id] !== undefined && values[i.id] !== '');
  return (
    <div className="count-sheet">
      <div className="count-progress">
        <div>
          <strong>
            {counted.length} / {items.length}
          </strong>
          <span>articles comptés</span>
        </div>
        <span className="count-bar">
          <i style={{ width: `${items.length ? (counted.length / items.length) * 100 : 0}%` }} />
        </span>
      </div>
      <div className="count-tools">
        <div className="zone-chips">
          <button className={zone === 'all' ? 'active' : ''} onClick={() => setZone('all')}>
            Toutes
          </button>
          {zones.map((z) => (
            <button key={z} className={zone === z ? 'active' : ''} onClick={() => setZone(z)}>
              {zoneDone(z) && <Check size={13} />}
              {z}
            </button>
          ))}
        </div>
        <div className="count-search">
          <div className="ledger-search">
            <Search size={16} />
            <input
              aria-label="Rechercher dans le comptage"
              placeholder="Rechercher…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="blind-toggle">
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
            Comptage à l’aveugle
          </label>
        </div>
      </div>
      <div className="count-list">
        {list.map((item) => {
          const v = values[item.id];
          const done = v !== undefined && v !== '';
          const n = done ? parseQty(v) : null;
          const diff = n === null ? 0 : roundQty(n - item.quantity);
          return (
            <div
              key={item.id}
              className={`count-row ${done ? 'is-done' : ''} ${done && n === null ? 'is-invalid' : ''}`}
            >
              <StockIcon category={item.category} size={17} />
              <span className="count-name">
                <strong>{item.name}</strong>
                <small>
                  {blind
                    ? item.zone
                    : `Théorique ${formatQty(Math.max(0, item.quantity), item.unit)}`}
                  {done && n !== null && diff !== 0 && !blind && (
                    <em className={diff > 0 ? 'positive' : 'negative'}>
                      {' '}
                      {diff > 0 ? '+' : '−'}
                      {qty(Math.abs(diff))}
                    </em>
                  )}
                </small>
              </span>
              <div className="count-controls">
                {!done && !blind && (
                  <button
                    type="button"
                    className="same-button"
                    aria-label={`${item.name} : quantité identique au stock théorique`}
                    onClick={() => set(item.id, inputQty(Math.max(0, item.quantity)))}
                  >
                    <Check size={16} />
                  </button>
                )}
                <Stepper
                  value={v ?? ''}
                  onChange={(val) => set(item.id, val)}
                  unit={item.unit}
                  label={`Quantité comptée pour ${item.name}`}
                />
                {done && (
                  <button
                    type="button"
                    className="undo-button"
                    aria-label={`Annuler le comptage de ${item.name}`}
                    onClick={() =>
                      setValues((p) => {
                        const next = { ...p };
                        delete next[item.id];
                        return next;
                      })
                    }
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!list.length && <div className="inline-empty">Aucun article dans cette sélection.</div>}
      </div>
      <div className="count-footer">
        <div>
          <span>
            {counted.length} compté{counted.length > 1 ? 's' : ''}
            {!blind && variance !== 0 && (
              <em className={variance > 0 ? 'positive' : 'negative'}>
                Écart {variance > 0 ? '+' : '−'}
                {money(Math.abs(variance))}
              </em>
            )}
          </span>
          {!!counted.length && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setValues({});
                writeDraft({});
              }}
            >
              <Trash2 size={13} />
              Effacer le brouillon
            </button>
          )}
        </div>
        {(localError || error) && (
          <p className="form-error" role="alert">
            {localError || error}
          </p>
        )}
        <button
          className="button button-primary full"
          disabled={busy || unavailable || !counted.length}
          onClick={async () => {
            setLocalError('');
            if (invalid.length) {
              setLocalError('Certaines quantités sont mal saisies (en rouge).');
              return;
            }
            const ok = await onSubmit({
              type: 'stock.count',
              lines: counted.map((id) => ({ itemId: id, quantity: parseQty(values[id])! })),
            });
            if (ok) writeDraft({});
          }}
        >
          {busy
            ? 'Enregistrement…'
            : `Valider ${counted.length || ''} comptage${counted.length > 1 ? 's' : ''}`}
          <Check size={18} />
        </button>
        <p className="field-help centered">Seuls les articles comptés sont mis à jour.</p>
      </div>
    </div>
  );
}

function ReceiveSheet({
  items,
  suppliers,
  supplier: initialSupplier,
  prefill,
  onSubmit,
  busy,
  error,
  unavailable,
}: {
  items: StockItem[];
  suppliers: string[];
  supplier?: string;
  prefill?: Record<string, number>;
  onSubmit: (a: Action) => Promise<boolean>;
  busy: boolean;
  error: string;
  unavailable: boolean;
}) {
  const line = (i: StockItem, q?: number) => ({
    itemId: i.id,
    quantity: q ? inputQty(q) : '',
    price: i.unitCost ? (i.unitCost / 100).toFixed(2).replace('.', ',') : '',
    expiresAt: '',
  });
  const [supplier, setSupplier] = useState(initialSupplier ?? '');
  const [date, setDate] = useState(today());
  const [lines, setLines] = useState(() =>
    prefill ? items.filter((i) => prefill[i.id]).map((i) => line(i, prefill[i.id])) : [],
  );
  const [withExpense, setWithExpense] = useState(true);
  const [category, setCategory] = useState(() =>
    (CATEGORIES as readonly string[]).includes(initialSupplier ?? '')
      ? initialSupplier!
      : 'Ingrédients',
  );
  const [payment, setPayment] = useState<string>('Carte bancaire');
  const [localError, setLocalError] = useState('');
  const available = items.filter((i) => !lines.some((l) => l.itemId === i.id));
  const suggestions = available.filter(
    (i) =>
      supplier && i.supplier.toLocaleLowerCase('fr') === supplier.trim().toLocaleLowerCase('fr'),
  );
  const total = lines.reduce((a, l) => {
    const q = parseQty(l.quantity);
    const p = parseEuros(l.price);
    return a + (q && p ? Math.round(q * p) : 0);
  }, 0);
  const update = (id: string, patch: Partial<ReturnType<typeof line>>) =>
    setLines((ls) => ls.map((l) => (l.itemId === id ? { ...l, ...patch } : l)));
  return (
    <form
      className="form receive-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError('');
        if (!lines.length) {
          setLocalError('Ajoutez au moins un article reçu.');
          return;
        }
        const parsed = lines.map((l) => ({ l, q: parseQty(l.quantity), p: parseEuros(l.price) }));
        const bad = parsed.find((x) => !x.q || x.p === null);
        if (bad) {
          const name = items.find((i) => i.id === bad.l.itemId)?.name;
          setLocalError(`Vérifiez la quantité et le prix de « ${name} ».`);
          return;
        }
        if (withExpense && parsed.some((x) => !x.p)) {
          setLocalError(
            'Indiquez le prix de chaque article pour créer la dépense, ou décochez l’option.',
          );
          return;
        }
        await onSubmit({
          type: 'stock.receive',
          supplier: supplier.trim(),
          date,
          lines: parsed.map((x) => ({
            itemId: x.l.itemId,
            quantity: x.q!,
            unitCost: x.p!,
            expiresAt: x.l.expiresAt || undefined,
          })),
          expense: withExpense ? { category, payment } : undefined,
        });
      }}
    >
      <div className="form-grid">
        <label>
          Fournisseur
          <input
            list="receive-suppliers"
            value={supplier}
            onChange={(e) => {
              setSupplier(e.target.value);
              if ((CATEGORIES as readonly string[]).includes(e.target.value))
                setCategory(e.target.value);
            }}
            placeholder="Ex. Gfd"
            maxLength={60}
          />
          <datalist id="receive-suppliers">
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label>
          Date de livraison
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
      </div>
      {!!suggestions.length && (
        <div className="supplier-suggestions">
          <span>Produits {supplier} :</span>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                ...suggestions.map((i) => line(i, suggestedOrder(i) || undefined)),
              ])
            }
          >
            <Plus size={14} />
            Tout ajouter ({suggestions.length})
          </button>
        </div>
      )}
      <div className="receive-lines">
        {lines.map((l) => {
          const item = items.find((i) => i.id === l.itemId)!;
          const q = parseQty(l.quantity);
          const p = parseEuros(l.price);
          return (
            <div className="receive-line" key={l.itemId}>
              <div className="receive-line-head">
                <StockIcon category={item.category} size={16} />
                <strong>{item.name}</strong>
                <span>{q && p ? money(Math.round(q * p)) : ''}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Retirer ${item.name}`}
                  onClick={() => setLines((ls) => ls.filter((x) => x.itemId !== l.itemId))}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="receive-line-fields">
                <label>
                  Quantité ({unitLabel(item.unit, 2)})
                  <input
                    inputMode="decimal"
                    placeholder="0"
                    value={l.quantity}
                    className={l.quantity && q === null ? 'is-invalid' : ''}
                    onChange={(e) => update(l.itemId, { quantity: e.target.value })}
                  />
                </label>
                <label>
                  Prix € / {item.unit}
                  <input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={l.price}
                    className={l.price && p === null ? 'is-invalid' : ''}
                    onChange={(e) => update(l.itemId, { price: e.target.value })}
                  />
                </label>
                <label>
                  DLC
                  <input
                    type="date"
                    min={today()}
                    value={l.expiresAt}
                    onChange={(e) => update(l.itemId, { expiresAt: e.target.value })}
                  />
                </label>
              </div>
            </div>
          );
        })}
        <label className="add-line">
          <Plus size={17} />
          <select
            value=""
            aria-label="Ajouter un article reçu"
            onChange={(e) => {
              const item = items.find((i) => i.id === e.target.value);
              if (item) setLines((ls) => [...ls, line(item)]);
            }}
          >
            <option value="">Ajouter un article reçu…</option>
            {STOCK_CATEGORIES.filter((c) => available.some((i) => i.category === c)).map((c) => (
              <optgroup key={c} label={c}>
                {available
                  .filter((i) => i.category === c)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      <div className="receive-expense">
        <label className="check-field">
          <input
            type="checkbox"
            checked={withExpense}
            onChange={(e) => setWithExpense(e.target.checked)}
          />
          Créer aussi la dépense dans le registre
        </label>
        {withExpense && (
          <div className="form-grid">
            <label>
              Catégorie
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Paiement
              <select value={payment} onChange={(e) => setPayment(e.target.value)}>
                {PAYMENTS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
      <div className="income-total">
        <span>
          Total de la livraison
          <small>
            {lines.length} article{lines.length > 1 ? 's' : ''}
          </small>
        </span>
        <strong>{money(total)}</strong>
      </div>
      {(localError || error) && (
        <p className="form-error" role="alert">
          {localError || error}
        </p>
      )}
      <button
        className="button button-primary full"
        disabled={busy || unavailable || !lines.length}
      >
        {busy ? 'Enregistrement…' : 'Valider la réception'}
        <Check size={18} />
      </button>
      <p className="field-help centered">
        Les prix saisis deviennent le nouveau prix d’achat des articles.
      </p>
    </form>
  );
}

function OrderSheet({
  items,
  notify,
  unavailable,
  onReceive,
}: {
  items: StockItem[];
  notify: (m: string) => void;
  unavailable: boolean;
  onReceive: (supplier: string, prefill: Record<string, number>) => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const parsedOverrides = Object.fromEntries(
    Object.entries(overrides).map(([id, v]) => [id, parseQty(v) ?? 0]),
  );
  const groups: OrderGroup[] = orderGroups(items, parsedOverrides);
  const base = orderGroups(items);
  // Keep rows visible while their quantity is being edited, even at zero.
  const editing = (g: OrderGroup) => {
    const extra = base
      .find((b) => b.supplier === g.supplier)
      ?.lines.filter((l) => !g.lines.some((x) => x.item.id === l.item.id))
      .map((l) => ({ ...l, quantity: 0, cost: 0 }));
    return [...g.lines, ...(extra ?? [])].sort((a, b) =>
      a.item.name.localeCompare(b.item.name, 'fr'),
    );
  };
  const all = [...new Set([...base.map((g) => g.supplier), ...groups.map((g) => g.supplier)])].map(
    (s) => groups.find((g) => g.supplier === s) ?? { supplier: s, lines: [], total: 0 },
  );
  const total = groups.reduce((a, g) => a + g.total, 0);
  const send = async (text: string, title: string) => {
    const r = await shareText(text, title);
    if (r === 'copied') notify('Liste copiée. Collez-la dans un SMS ou WhatsApp.');
    else if (r === 'failed') notify('Partage impossible sur cet appareil.');
  };
  if (!base.length)
    return (
      <Empty
        title="Rien à commander"
        body="Tous les articles suivis sont au-dessus de leur seuil d’alerte. Pensez à compter régulièrement pour garder ce calcul juste."
      />
    );
  return (
    <div className="order-sheet">
      {all.map((g) => (
        <section className="order-group" key={g.supplier}>
          <header>
            <div>
              <h3>{g.supplier}</h3>
              <small>
                {g.lines.length} produit{g.lines.length > 1 ? 's' : ''}
                {g.total ? ` · ≈ ${money(g.total)}` : ''}
              </small>
            </div>
            <div className="order-actions">
              <button
                className="button button-secondary"
                disabled={!g.lines.length}
                onClick={() => void send(orderMessage(g), `Commande ${g.supplier}`)}
              >
                <Send size={15} />
                Envoyer
              </button>
              <button
                className="button button-soft"
                disabled={!g.lines.length || unavailable}
                onClick={() =>
                  onReceive(
                    g.supplier === 'Sans fournisseur' ? '' : g.supplier,
                    Object.fromEntries(g.lines.map((l) => [l.item.id, l.quantity])),
                  )
                }
              >
                <Truck size={15} />
                Reçue
              </button>
            </div>
          </header>
          {editing(g).map((l) => (
            <div className="order-line" key={l.item.id}>
              <StockIcon category={l.item.category} size={16} />
              <span>
                <strong>{l.item.name}</strong>
                <small>
                  En stock {formatQty(Math.max(0, l.item.quantity), l.item.unit)}
                  {l.item.parQuantity ? ` · idéal ${qty(l.item.parQuantity)}` : ''}
                </small>
              </span>
              <label className="order-qty">
                <input
                  inputMode="decimal"
                  aria-label={`Quantité à commander : ${l.item.name}`}
                  value={overrides[l.item.id] ?? inputQty(l.quantity)}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setOverrides({ ...overrides, [l.item.id]: e.target.value })}
                />
                <small>{unitLabel(l.item.unit, l.quantity)}</small>
              </label>
            </div>
          ))}
        </section>
      ))}
      <div className="order-footer">
        <div className="income-total">
          <span>
            Estimation totale
            <small>Selon les derniers prix d’achat connus</small>
          </span>
          <strong>{money(total)}</strong>
        </div>
        <button
          className="button button-primary full"
          disabled={!groups.length}
          onClick={() => void send(orderSummary(groups), 'Liste de commande Burger House')}
        >
          <Copy size={17} />
          Partager toute la liste
        </button>
      </div>
    </div>
  );
}

function LossSheet({
  items,
  onSubmit,
  busy,
  error,
  unavailable,
}: {
  items: StockItem[];
  onSubmit: (a: Action) => Promise<boolean>;
  busy: boolean;
  error: string;
  unavailable: boolean;
}) {
  const day = today();
  const expired = items.filter((i) => expiryLevel(i, day) === 'expired');
  const [itemId, setItemId] = useState(expired[0]?.id ?? '');
  const [value, setValue] = useState(expired[0] ? inputQty(expired[0].quantity) : '');
  const [reason, setReason] = useState<string>(expired[0] ? 'Périmé' : '');
  const [localError, setLocalError] = useState('');
  const item = items.find((i) => i.id === itemId);
  const n = parseQty(value);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError('');
        if (!item) return setLocalError('Choisissez un article.');
        if (!n) return setLocalError('Indiquez la quantité perdue.');
        if (!reason) return setLocalError('Choisissez le motif.');
        await onSubmit({ type: 'stock.move', itemId: item.id, kind: 'loss', quantity: n, reason });
      }}
    >
      <label>
        Article
        <select
          value={itemId}
          onChange={(e) => {
            setItemId(e.target.value);
            setValue('');
          }}
          required
        >
          <option value="" disabled>
            Choisir un article…
          </option>
          {STOCK_CATEGORIES.filter((c) => items.some((i) => i.category === c)).map((c) => (
            <optgroup key={c} label={c}>
              {items
                .filter((i) => i.category === c)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · {formatQty(Math.max(0, i.quantity), i.unit)}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {item && (
        <>
          <Stepper value={value} onChange={setValue} unit={item.unit} label="Quantité perdue" />
          <div className="quick-chips">
            {chipsFor(item.unit).map((c) => (
              <button
                type="button"
                key={c}
                className={n === c ? 'active' : ''}
                onClick={() => setValue(inputQty(c))}
              >
                {qty(c)}
              </button>
            ))}
            {item.quantity > 0 && (
              <button type="button" onClick={() => setValue(inputQty(item.quantity))}>
                Tout
              </button>
            )}
          </div>
          {!!n && item.unitCost > 0 && (
            <p className="move-preview">
              Valeur perdue : <strong>{money(Math.round(n * item.unitCost))}</strong>
            </p>
          )}
        </>
      )}
      <div className="reason-chips" role="group" aria-label="Motif">
        {LOSS_REASONS.map((r) => (
          <button
            type="button"
            key={r}
            aria-pressed={reason === r}
            className={reason === r ? 'active' : ''}
            onClick={() => setReason(r)}
          >
            {r}
          </button>
        ))}
      </div>
      {(localError || error) && (
        <p className="form-error" role="alert">
          {localError || error}
        </p>
      )}
      <button className="button button-primary full" disabled={busy || unavailable}>
        {busy ? 'Enregistrement…' : 'Déclarer la perte'}
        <Check size={18} />
      </button>
    </form>
  );
}

function CatalogSheet({
  existing,
  onSubmit,
  busy,
  error,
  unavailable,
}: {
  existing: StockItem[];
  onSubmit: (a: Action) => Promise<boolean>;
  busy: boolean;
  error: string;
  unavailable: boolean;
}) {
  const has = (name: string) =>
    existing.some((i) => i.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'));
  // Built from the restaurant's own menu: everything starts ticked, the manager unticks mistakes.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(BURGER_CATALOG.filter((i) => !has(i.name)).map((i) => i.name)),
  );
  const toggle = (names: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      names.forEach((n) => (on ? next.add(n) : next.delete(n)));
      return next;
    });
  const groups = STOCK_CATEGORIES.map(
    (c) => [c, BURGER_CATALOG.filter((i) => i.category === c)] as const,
  ).filter(([, l]) => l.length);
  return (
    <div className="catalog-sheet">
      <div className="catalog-intro">
        <Sparkles size={18} />
        <p>
          Liste préparée d’après <strong>votre carte bhouse26.fr</strong> : tacos, pizzas, burgers,
          bowls, riz, satays et finger food. Le site ne donne pas les recettes : les ingrédients
          sont déduits du nom des plats. <strong>Décochez ce qui ne vous concerne pas</strong>, et
          modifiez ou supprimez un article à tout moment.
        </p>
      </div>
      {groups.map(([category, list]) => {
        const free = list.filter((i) => !has(i.name)).map((i) => i.name);
        const all = free.length > 0 && free.every((n) => selected.has(n));
        return (
          <section key={category} className="catalog-group">
            <header>
              <StockIcon category={category} size={16} />
              <h3>{category}</h3>
              {!!free.length && (
                <button type="button" className="text-button" onClick={() => toggle(free, !all)}>
                  {all ? 'Tout retirer' : 'Tout cocher'}
                </button>
              )}
            </header>
            {list.map((i) => {
              const present = has(i.name);
              return (
                <label key={i.name} className={`catalog-item ${present ? 'is-present' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={present}
                    checked={present || selected.has(i.name)}
                    onChange={(e) => toggle([i.name], e.target.checked)}
                  />
                  <span>
                    {i.name}
                    <small>
                      {present
                        ? 'Déjà dans l’inventaire'
                        : `${i.unit} · ${i.zone} · ${i.supplier} · alerte ${qty(i.minQuantity)}`}
                    </small>
                    <em>Pour : {i.usedIn.join(', ')}</em>
                  </span>
                </label>
              );
            })}
          </section>
        );
      })}
      <div className="count-footer">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button button-primary full"
          disabled={busy || unavailable || !selected.size}
          onClick={() =>
            void onSubmit({
              type: 'stock.items.import',
              items: BURGER_CATALOG.filter((i) => selected.has(i.name)).map(
                ({ usedIn: _, ...item }) => item,
              ),
            })
          }
        >
          {busy
            ? 'Ajout…'
            : selected.size
              ? `Ajouter ${selected.size} article${selected.size > 1 ? 's' : ''}`
              : 'Cochez vos produits'}
          <Check size={18} />
        </button>
        <p className="field-help centered">
          Les seuils proposés sont indicatifs. Faites ensuite un comptage pour saisir vos quantités.
        </p>
      </div>
    </div>
  );
}

/** Compact stock alert card for the summary page. */
export function StockAlertCard({ state, onOpen }: { state: State; onOpen: () => void }): ReactNode {
  const items = (state.stock ?? []).filter((i) => i.active);
  const day = today();
  const order = items.filter(needsOrder);
  const expiring = items.filter((i) => expiryLevel(i, day));
  return (
    <section className="panel stock-alert-card">
      <header className="panel-header">
        <div>
          <h2>Inventaire</h2>
          <p>
            {items.length
              ? `${items.length} articles · ${money(stockValue(items), false)}`
              : 'À configurer'}
          </p>
        </div>
        <span className="sidebar-symbol sidebar-inventory">
          <Package size={17} />
        </span>
      </header>
      {items.length ? (
        <div className="stock-alert-lines">
          <button onClick={onOpen} className={order.length ? 'is-warning' : ''}>
            <ShoppingCart size={16} />
            <span>{order.length ? `${order.length} à commander` : 'Rien à commander'}</span>
            <ChevronRight size={14} />
          </button>
          <button onClick={onOpen} className={expiring.length ? 'is-warning' : ''}>
            <CalendarClock size={16} />
            <span>
              {expiring.length ? `${expiring.length} DLC à surveiller` : 'Aucune DLC proche'}
            </span>
            <ChevronRight size={14} />
          </button>
        </div>
      ) : (
        <button className="rail-link" onClick={onOpen}>
          Créer mon inventaire
          <ChevronRight size={15} />
        </button>
      )}
    </section>
  );
}
