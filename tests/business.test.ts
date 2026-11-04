import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, initialState, publicState } from '../src/lib/engine';
import { csv, duration, shiftMs, totals, inPeriod } from '../src/lib/model';
import { handleState, Store } from '../src/lib/api';
const at = new Date('2026-11-04T12:00:00Z');
test('le pointage déduit une pause, empêche les doubles arrivées et vérifie le code', async () => {
  let s = await initialState(false);
  s = await applyAction(
    s,
    { type: 'employee.add', name: 'Test Employé', role: 'Cuisine', hourlyCost: 1850, pin: '4321' },
    at,
  );
  const id = s.employees[0].id;
  await assert.rejects(
    applyAction(s, { type: 'clock', employeeId: id, pin: '0000', event: 'in' }, at),
    /incorrect/,
  );
  s = await applyAction(s, { type: 'clock', employeeId: id, pin: '4321', event: 'in' }, at);
  await assert.rejects(
    applyAction(s, { type: 'clock', employeeId: id, pin: '4321', event: 'in' }, at),
    /déjà/,
  );
  s = await applyAction(
    s,
    { type: 'clock', employeeId: id, pin: '4321', event: 'pause' },
    new Date(+at + 3600000),
  );
  assert.equal(shiftMs(s.shifts[0], +at + 4500000), 3600000);
  s = await applyAction(
    s,
    { type: 'clock', employeeId: id, pin: '4321', event: 'resume' },
    new Date(+at + 4500000),
  );
  s = await applyAction(
    s,
    { type: 'clock', employeeId: id, pin: '4321', event: 'out' },
    new Date(+at + 7200000),
  );
  assert.equal(shiftMs(s.shifts[0]), 6300000);
  assert.equal(duration(shiftMs(s.shifts[0])), '1 h 45');
  assert.equal(publicState(s).employees[0].pinHash, undefined);
  assert.ok(s.employees[0].pinHash);
});
test('une fin de service pendant une pause déduit toute la pause', async () => {
  let s = await initialState(true, at);
  const e = s.employees[2];
  const before = shiftMs(s.shifts[2], +at);
  s = await applyAction(
    s,
    { type: 'clock', employeeId: e.id, pin: '1234', event: 'out' },
    new Date(+at + 3600000),
  );
  assert.equal(shiftMs(s.shifts[2]), before);
});
test('les montants restent en centimes et les annulations conservent la trace', async () => {
  let s = await initialState(false);
  const entry = {
    type: 'expense' as const,
    title: 'Pain',
    amount: 1020,
    category: 'Ingrédients',
    payment: 'Carte bancaire',
    date: '2026-11-04',
    supplier: 'Test',
    note: '',
    items: [{ name: 'Pain', quantity: 3, unitPrice: 340 }],
  };
  s = await applyAction(s, { type: 'entry.add', entry }, at);
  assert.equal(totals(s.entries).expense, 1020);
  assert.equal(s.entries[0].items[0].quantity, 3);
  s = await applyAction(s, { type: 'entry.void', id: s.entries[0].id }, at);
  assert.equal(totals(s.entries).expense, 0);
  assert.equal(s.entries.length, 1);
  assert.ok(s.entries[0].voidedAt);
  assert.equal(s.audit.length, 2);
  await assert.rejects(applyAction(s, { type: 'entry.void', id: s.entries[0].id }, at), /annulée/);
  await assert.rejects(
    applyAction(s, { type: 'entry.add', entry: { ...entry, amount: 1000 } }, at),
    /total/,
  );
  await assert.rejects(
    applyAction(s, { type: 'entry.add', entry: { ...entry, date: '2026-02-31' } }, at),
    /date valide/,
  );
});
test('les filtres suivent les périodes et le CSV protège les formules', () => {
  assert.ok(inPeriod('2026-11-30', '2026-11-04', 'month'));
  assert.ok(!inPeriod('2025-11-30', '2026-11-04', 'year'));
  assert.ok(csv([['=HYPERLINK("x")', 'ligne\n2']]).includes("'=HYPERLINK"));
});
test('les données réelles sont vierges et séparées des exemples', async () => {
  const a = await initialState(false, at),
    b = await initialState(true, at);
  assert.equal(a.entries.length, 0);
  assert.equal(a.employees.length, 0);
  assert.ok(b.entries.length > 300);
  assert.equal(publicState(b).employees[0].pinHash, undefined);
});
test('l’API empêche la perte de modifications et les doublons de requêtes', async () => {
  let snapshot: { state: Awaited<ReturnType<typeof initialState>>; revision: number } | null = null;
  const store: Store = {
    async read() {
      return snapshot ? structuredClone(snapshot) : null;
    },
    async insert(_, state) {
      snapshot ??= { state, revision: 0 };
    },
    async update(_, revision, state) {
      if (snapshot?.revision !== revision) return false;
      snapshot = { state, revision: revision + 1 };
      return true;
    },
  };
  const get = await handleState(new Request('http://localhost/api/state?mode=live'), store);
  assert.equal(get.status, 200);
  const body = {
    revision: 0,
    requestId: 'request-123456789012345',
    action: { type: 'note.add', title: 'Test', body: 'Persisté', category: 'Service' },
  };
  const request = () =>
    new Request('http://localhost/api/state?mode=live', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify(body),
    });
  const first = await handleState(request(), store);
  assert.equal(first.status, 200);
  const duplicate = await handleState(request(), store);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).state.notes.length, 1);
  body.requestId = 'request-234567890123456';
  const conflict = await handleState(request(), store);
  assert.equal(conflict.status, 409);
  const forged = await handleState(
    new Request('http://localhost/api/state?mode=live', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify(body),
    }),
    store,
  );
  assert.equal(forged.status, 403);
});
