import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, initialState, publicState } from '../src/lib/engine';
import { csv, duration, shiftMs, totals, inPeriod } from '../src/lib/model';
import { handleState, Store } from '../src/lib/api';
const at = new Date('2026-11-04T12:00:00Z');
test('le pointage déduit une pause, empêche les doubles arrivées et vérifie le code', async () => {
  let s = await initialState();
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
  let s = await initialState();
  s = await applyAction(
    s,
    { type: 'employee.add', name: 'Employé test', role: 'Cuisine', hourlyCost: 1800, pin: '4321' },
    at,
  );
  const id = s.employees[0].id;
  s = await applyAction(s, { type: 'clock', employeeId: id, pin: '4321', event: 'in' }, at);
  s = await applyAction(
    s,
    { type: 'clock', employeeId: id, pin: '4321', event: 'pause' },
    new Date(+at + 3600000),
  );
  s = await applyAction(
    s,
    { type: 'clock', employeeId: id, pin: '4321', event: 'out' },
    new Date(+at + 7200000),
  );
  assert.equal(shiftMs(s.shifts[0]), 3600000);
});
test('les montants restent en centimes et les annulations conservent la trace', async () => {
  let s = await initialState();
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
test('un nouveau restaurant ne contient aucune donnée fictive ni objectif inventé', async () => {
  const state = await initialState();
  assert.equal(state.entries.length, 0);
  assert.equal(state.employees.length, 0);
  assert.equal(state.shifts.length, 0);
  assert.equal(state.notes.length, 0);
  assert.equal(state.audit.length, 0);
  assert.equal(state.goal, 0);
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

test('l’API refuse le mode démonstration et démarre directement sur le registre réel', async () => {
  const state = await initialState();
  let reads = 0;
  const store: Store = {
    async read() {
      reads++;
      return { state, revision: 0 };
    },
    async insert() {},
    async update() {
      return true;
    },
  };
  const demo = await handleState(new Request('http://localhost/api/state?mode=demo'), store);
  assert.equal(demo.status, 400);
  assert.equal(reads, 0);
  const real = await handleState(new Request('http://localhost/api/state'), store);
  assert.equal(real.status, 200);
  assert.equal((await real.json()).state.entries.length, 0);
});

test('les requêtes locales conservent la protection contre les origines tierces', async () => {
  const { isSameOrigin } = await import('../src/lib/origin');
  assert.equal(
    isSameOrigin(
      new Request('http://localhost:3012/api/state', {
        headers: { host: '127.0.0.1:3012', origin: 'http://127.0.0.1:3012' },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOrigin(
      new Request('https://burger-house.example/api/state', {
        headers: { host: 'burger-house.example', origin: 'https://evil.example' },
      }),
    ),
    false,
  );
});
