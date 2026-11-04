import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const worker = (await import('../dist/server/index.js')).default;
const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync('drizzle/0000_workspace.sql', 'utf8'));
const wrap = (query, values = []) => ({
  query,
  values,
  bind(...v) {
    return wrap(query, v);
  },
  async first() {
    return sql.prepare(query).get(...values) ?? null;
  },
  async all() {
    return { results: sql.prepare(query).all(...values) };
  },
  async run() {
    return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
  },
});
const env = {
  DB: {
    prepare: wrap,
    async batch(queries) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        const result = [];
        for (const q of queries)
          result.push({ meta: { changes: Number(sql.prepare(q.query).run(...q.values).changes) } });
        sql.exec('COMMIT');
        return result;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  },
};
const url = 'https://burger-house.example';
let r = await worker.fetch(new Request(url + '/'), env);
assert.equal(r.status, 200);
assert.match(r.headers.get('content-type'), /text\/html/);
const html = await r.text();
assert.match(html, /manifest.webmanifest/);
assert.match(html, /Burger House/);
const script = [...html.matchAll(/src="([^"]+\.js)"/g)][0]?.[1];
assert.ok(script);
r = await worker.fetch(new Request(url + script), env);
assert.equal(r.status, 200);
assert.match(r.headers.get('content-type'), /javascript/);
r = await worker.fetch(new Request(url + '/sw.js'), env);
const sw = await r.text();
assert.match(sw, /burger-house-shell-[a-f0-9]{12}/);
assert.match(sw, /_next\/static/);
r = await worker.fetch(new Request(url + '/api/state?mode=live'), env);
assert.equal(r.status, 401);
const headers = { 'oai-authenticated-user-id': 'worker-test-owner' };
r = await worker.fetch(new Request(url + '/api/state?mode=live', { headers }), env);
assert.equal(r.status, 200);
const empty = await r.json();
assert.equal(empty.state.entries.length, 0);
assert.equal(empty.revision, 0);
assert.equal(empty.state.goal, 0);
assert.equal(empty.state.employees.length, 0);
r = await worker.fetch(
  new Request(url + '/api/state?mode=live', {
    headers: { ...headers, 'If-None-Match': '"live-0"' },
  }),
  env,
);
assert.equal(r.status, 304);
const post = async (action, revision = 0, id = crypto.randomUUID()) =>
  worker.fetch(
    new Request(url + '/api/state?mode=live', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ action, revision, requestId: id }),
    }),
    env,
  );
r = await post({
  type: 'entry.add',
  entry: {
    type: 'income',
    title: 'Service test',
    amount: 12345,
    date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date()),
    category: 'Sur place',
    payment: 'Carte bancaire',
    supplier: '',
    note: '',
    items: [],
  },
});
assert.equal(r.status, 200);
const entry = await r.json();
assert.equal(entry.state.entries[0].amount, 12345);
r = await post({ type: 'note.add', title: 'Conflit', body: '', category: 'Service' }, 0);
assert.equal(r.status, 409);
r = await post(
  { type: 'employee.add', name: 'Équipier test', role: 'Cuisine', hourlyCost: 1800, pin: '4321' },
  1,
);
assert.equal(r.status, 200);
const employee = await r.json();
const employeeId = employee.state.employees[0].id;
assert.equal(employee.state.employees[0].pinHash, undefined);
for (let i = 0; i < 5; i++) {
  r = await post({ type: 'clock', employeeId, pin: '0000', event: 'in' }, 2);
  assert.equal(r.status, 400);
}
r = await post({ type: 'clock', employeeId, pin: '4321', event: 'in' }, 2);
assert.equal(r.status, 429);
assert.equal(sql.prepare('SELECT count FROM clock_attempts').get().count, 5);
sql.prepare('DELETE FROM clock_attempts').run();
r = await post({ type: 'clock', employeeId, pin: '4321', event: 'in' }, 2);
assert.equal(r.status, 200);
const clock = await r.json();
assert.equal(clock.state.shifts.length, 1);
r = await post({ type: 'entry.void', id: entry.state.entries[0].id }, 3);
assert.equal(r.status, 200);
const voided = await r.json();
assert.ok(voided.state.entries[0].voidedAt);
assert.ok(voided.state.audit.length >= 4);
const race = await Promise.all([
  post({ type: 'note.add', title: 'Service A', body: '', category: 'Service' }, 4),
  post({ type: 'note.add', title: 'Service B', body: '', category: 'Service' }, 4),
]);
assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
r = await worker.fetch(new Request(url + '/api/state?mode=demo', { headers }), env);
assert.equal(r.status, 400);
r = await worker.fetch(new Request(url + '/api/state?mode=live', { headers }), env);
const live = await r.json();
assert.equal(live.state.employees.length, 1);
assert.equal(live.state.entries.length, 1);
console.log(
  'Worker vérifié : ressources Next.js, PWA, authentification, écritures, annulations, conflits, pointage, verrouillage persistant et refus des données fictives.',
);
sql.close();
