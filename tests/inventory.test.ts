import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, initialState } from '../src/lib/engine';
import { totals, type State, type StockItemInput } from '../src/lib/model';
import {
  BURGER_CATALOG,
  dailyUsage,
  needsOrder,
  orderGroups,
  stockLevel,
  stockValue,
  suggestedOrder,
  formatQty,
} from '../src/lib/inventory';
import { revenueStatement, statementCsv } from '../src/lib/revenue';
import { pack, unpack, metadata } from '../src/lib/records';

const at = new Date('2026-11-07T12:00:00Z');
const steak: StockItemInput = {
  name: 'Steak 150 g',
  category: 'Viandes',
  unit: 'pièce',
  zone: 'Congélateur',
  supplier: 'Gfd',
  minQuantity: 20,
  parQuantity: 100,
  unitCost: 95,
};

test('les recettes du jour se saisissent par canal, sans libellé', async () => {
  let s = await initialState();
  s = await applyAction(
    s,
    { type: 'income.day', date: '2026-11-07', amounts: { CB: 12050, Mypos: 4000, Uber: 2590 } },
    at,
  );
  assert.equal(s.entries.length, 3);
  assert.deepEqual(s.entries.map((e) => e.title).sort(), ['CB', 'Mypos', 'Uber']);
  assert.ok(s.entries.every((e) => e.payment === e.category && e.type === 'income'));
  assert.equal(totals(s.entries).income, 18640);
  await assert.rejects(
    applyAction(s, { type: 'income.day', date: '2026-11-07', amounts: {} }, at),
    /au moins/,
  );
  await assert.rejects(
    applyAction(s, { type: 'income.day', date: '2026-11-08', amounts: { CB: 100 } }, at),
    /date valide/,
  );
  await assert.rejects(
    applyAction(
      s,
      { type: 'income.day', date: '2026-11-07', amounts: { CB: 100, Ticket: 50 } as never },
      at,
    ),
    /inconnu/,
  );
  // The legacy single-entry action accepts an empty label for a revenue.
  s = await applyAction(
    s,
    {
      type: 'entry.add',
      entry: {
        type: 'income',
        title: '',
        amount: 500,
        category: 'Espèces',
        payment: 'Espèces',
        date: '2026-11-07',
        supplier: '',
        note: '',
        items: [],
      },
    },
    at,
  );
  assert.equal(s.entries[0].title, 'Espèces');
});

test('le relevé mensuel détaille chaque jour par canal avec le total', async () => {
  let s = await initialState();
  s = await applyAction(
    s,
    { type: 'income.day', date: '2026-11-01', amounts: { CB: 10000, Espèces: 2500 } },
    at,
  );
  s = await applyAction(
    s,
    { type: 'income.day', date: '2026-11-03', amounts: { Mypos: 3000, Uber: 1234 } },
    at,
  );
  s = await applyAction(s, { type: 'income.day', date: '2026-11-03', amounts: { CB: 1000 } }, at);
  s = await applyAction(s, { type: 'income.day', date: '2026-10-31', amounts: { CB: 99900 } }, at);
  const st = revenueStatement(s.entries, '2026-11-15', 'month', '2026-11-07');
  assert.equal(st.rows.length, 7, 'les jours futurs ne sont pas affichés');
  assert.equal(st.rows[0].channels.CB, 10000);
  assert.equal(st.rows[2].total, 5234);
  assert.equal(st.total, 17734);
  assert.deepEqual(st.totals, { CB: 11000, Mypos: 3000, Espèces: 2500, Uber: 1234 });
  assert.equal(st.activeRows, 2);
  assert.equal(st.best?.key, '2026-11-01');
  const file = statementCsv(st, 'month');
  assert.match(file, /"Jour";"Date";"CB";"Mypos";"Espèces";"Uber";"Total"/);
  assert.match(file, /"1";"dimanche 1 novembre 2026";"100,00";"0,00";"25,00";"0,00";"125,00"/);
  assert.match(file, /"TOTAL";"";"110,00";"30,00";"25,00";"12,34";"177,34"/);
  const year = revenueStatement(s.entries, '2026-11-07', 'year', '2026-11-07');
  assert.equal(year.rows.length, 11);
  assert.equal(year.rows[9].total, 99900);
  assert.equal(year.rows[10].label, 'Novembre');
});

async function withSteak(initial = 50) {
  const s = await applyAction(
    await initialState(),
    { type: 'stock.item.save', item: steak, initialQuantity: initial },
    at,
    'zakaria@example.com',
  );
  return { s, id: s.stock[0].id };
}

test('les mouvements de stock tiennent la quantité, les pertes et l’historique', async () => {
  let { s, id } = await withSteak();
  assert.equal(s.stock[0].quantity, 50);
  assert.equal(s.stockMoves[0].kind, 'count');
  s = await applyAction(s, { type: 'stock.move', itemId: id, kind: 'out', quantity: 12 }, at);
  assert.equal(s.stock[0].quantity, 38);
  await assert.rejects(
    applyAction(s, { type: 'stock.move', itemId: id, kind: 'out', quantity: 39 }, at),
    /stock enregistré est de 38/,
  );
  await assert.rejects(
    applyAction(s, { type: 'stock.move', itemId: id, kind: 'loss', quantity: 2 }, at),
    /motif/,
  );
  s = await applyAction(
    s,
    { type: 'stock.move', itemId: id, kind: 'loss', quantity: 3, reason: 'Périmé' },
    at,
  );
  assert.equal(s.stock[0].quantity, 35);
  assert.equal(s.stockMoves[0].delta, -3);
  assert.equal(s.stockMoves[0].unitCost, 95);
  s = await applyAction(
    s,
    {
      type: 'stock.move',
      itemId: id,
      kind: 'in',
      quantity: 10,
      unitCost: 99,
      expiresAt: '2026-12-01',
    },
    at,
  );
  assert.equal(s.stock[0].quantity, 45);
  assert.equal(s.stock[0].unitCost, 99);
  assert.equal(s.stock[0].expiresAt, '2026-12-01');
  await assert.rejects(
    applyAction(s, { type: 'stock.item.save', item: { ...steak, name: 'steak 150 G ' } }, at),
    /déjà ce nom/,
  );
  s = await applyAction(s, { type: 'stock.item.archive', id }, at);
  await assert.rejects(
    applyAction(s, { type: 'stock.move', itemId: id, kind: 'out', quantity: 1 }, at),
    /archivé/,
  );
});

test('le comptage enregistre uniquement les écarts et date le dernier comptage', async () => {
  let { s, id } = await withSteak(50);
  s = await applyAction(
    s,
    {
      type: 'stock.item.save',
      item: { ...steak, name: 'Cheddar', unit: 'kg', category: 'Fromages' },
    },
    at,
  );
  const cheddar = s.stock.find((i) => i.name === 'Cheddar')!.id;
  const before = s.stockMoves.length;
  s = await applyAction(
    s,
    {
      type: 'stock.count',
      lines: [
        { itemId: id, quantity: 47 },
        { itemId: cheddar, quantity: 0 },
      ],
    },
    new Date('2026-11-07T13:00:00Z'),
  );
  assert.equal(s.stockMoves.length, before + 1);
  assert.equal(s.stockMoves[0].delta, -3);
  assert.ok(s.stock.every((i) => i.lastCountedAt === '2026-11-07T13:00:00.000Z'));
  assert.match(s.audit[0].text, /2 articles, 1 écart/);
  await assert.rejects(
    applyAction(
      s,
      {
        type: 'stock.count',
        lines: [
          { itemId: id, quantity: 1 },
          { itemId: id, quantity: 2 },
        ],
      },
      at,
    ),
    /deux fois/,
  );
});

test('une réception met le stock à jour et crée la dépense correspondante', async () => {
  let { s, id } = await withSteak(5);
  s = await applyAction(
    s,
    {
      type: 'stock.item.save',
      item: { ...steak, name: 'Frites', unit: 'kg', category: 'Frites & surgelés' },
    },
    at,
  );
  const fries = s.stock.find((i) => i.name === 'Frites')!.id;
  s = await applyAction(
    s,
    {
      type: 'stock.receive',
      supplier: 'Gfd',
      date: '2026-11-07',
      lines: [
        { itemId: id, quantity: 120, unitCost: 92 },
        { itemId: fries, quantity: 12.5, unitCost: 189 },
      ],
      expense: { category: 'Gfd', payment: 'Virement' },
    },
    at,
  );
  assert.equal(s.stock.find((i) => i.id === id)!.quantity, 125);
  assert.equal(s.stock.find((i) => i.id === fries)!.quantity, 12.5);
  const expense = s.entries[0];
  assert.equal(expense.type, 'expense');
  assert.equal(expense.category, 'Gfd');
  assert.equal(expense.amount, 120 * 92 + Math.round(12.5 * 189));
  assert.equal(expense.items.length, 2);
  assert.ok(s.stockMoves.slice(0, 2).every((m) => m.entryId === expense.id && m.batchId));
  await assert.rejects(
    applyAction(
      s,
      {
        type: 'stock.receive',
        supplier: 'Gfd',
        date: '2026-11-07',
        lines: [{ itemId: id, quantity: 1, unitCost: 0 }],
        expense: { category: 'Gfd', payment: 'Virement' },
      },
      at,
    ),
    /prix/,
  );
});

test('le catalogue ajoute les produits choisis sans doublon', async () => {
  let s = await initialState();
  s = await applyAction(s, { type: 'stock.items.import', items: BURGER_CATALOG.slice(0, 5) }, at);
  assert.equal(s.stock.length, 5);
  s = await applyAction(s, { type: 'stock.items.import', items: BURGER_CATALOG.slice(3, 8) }, at);
  assert.equal(s.stock.length, 8);
  await assert.rejects(
    applyAction(s, { type: 'stock.items.import', items: BURGER_CATALOG.slice(0, 2) }, at),
    /existent déjà/,
  );
});

test('les alertes, la commande suggérée et l’autonomie suivent le stock réel', async () => {
  let { s, id } = await withSteak(30);
  const item = () => s.stock[0];
  assert.equal(stockLevel(item()), 'ok');
  assert.equal(needsOrder(item()), false);
  s = await applyAction(s, { type: 'stock.move', itemId: id, kind: 'out', quantity: 12 }, at);
  assert.equal(stockLevel(item()), 'low');
  assert.equal(suggestedOrder(item()), 82);
  s = await applyAction(
    s,
    {
      type: 'stock.item.save',
      id,
      item: { ...steak, unit: 'kg', minQuantity: 20, parQuantity: 25.2 },
    },
    at,
  );
  assert.equal(suggestedOrder(item()), 7.5, 'les kilos sont arrondis au demi supérieur');
  const groups = orderGroups(s.stock);
  assert.equal(groups[0].supplier, 'Gfd');
  assert.equal(groups[0].total, Math.round(7.5 * 95));
  assert.equal(stockValue(s.stock), 18 * 95);
  const usage = dailyUsage(item(), s.stockMoves, new Date('2026-11-10T12:00:00Z'));
  assert.equal(usage, 4, '12 sorties observées sur 3 jours');
  assert.equal(formatQty(3, 'pièce'), '3 pièces');
  assert.equal(formatQty(1.5, 'kg'), '1,5 kg');
});

test('le stock est conservé dans le registre par enregistrements', async () => {
  const { s } = await withSteak(10);
  const back: State = unpack(metadata(s), pack(s));
  assert.equal(back.stock[0].quantity, 10);
  assert.equal(back.stockMoves.length, 1);
  const legacy = unpack(JSON.stringify({ goal: 0 }), []);
  assert.deepEqual(legacy.stock, []);
});
