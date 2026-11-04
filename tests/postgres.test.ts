import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { createPostgresStore } from '../src/lib/postgres';
import { initialState, applyAction } from '../src/lib/engine';
import { today } from '../src/lib/model';
test(
  'Postgres conserve les saisies entre connexions et protège les écritures simultanées',
  { skip: process.env.BURGER_HOUSE_TEST_DATABASE !== '1' },
  async () => {
    const root = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL, max: 1 });
    const schema = 'test_' + crypto.randomUUID().replaceAll('-', '');
    let pool: Pool | undefined;
    try {
      await root.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({
        connectionString: process.env.DIRECT_DATABASE_URL,
        options: `-c search_path=${schema}`,
        max: 3,
      });
      await pool.query(readFileSync('migrations/postgres/0001_records.sql', 'utf8'));
      let store = createPostgresStore(pool);
      const empty = await initialState();
      await store.insert('live', empty);
      assert.equal((await store.read('live'))?.state.goal, 0);
      let next = await applyAction(empty, {
        type: 'entry.add',
        entry: {
          type: 'income',
          title: 'Test isolé',
          amount: 1400,
          category: 'Sur place',
          payment: 'Carte bancaire',
          date: today(),
          supplier: '',
          note: '',
          items: [],
        },
      });
      assert.equal(await store.update('live', 0, next), true);
      await pool.end();
      pool = new Pool({
        connectionString: process.env.DIRECT_DATABASE_URL,
        options: `-c search_path=${schema}`,
        max: 3,
      });
      store = createPostgresStore(pool);
      const saved = await store.read('live');
      assert.equal(saved?.revision, 1);
      assert.equal(saved?.state.entries[0].amount, 1400);
      const a = await applyAction(saved!.state, {
        type: 'note.add',
        title: 'A',
        body: '',
        category: 'Service',
      });
      const b = await applyAction(saved!.state, {
        type: 'note.add',
        title: 'B',
        body: '',
        category: 'Service',
      });
      const results = await Promise.all([store.update('live', 1, a), store.update('live', 1, b)]);
      assert.deepEqual(results.sort(), [false, true]);
      assert.equal((await store.read('live'))?.state.notes.length, 1);
      for (let i = 0; i < 5; i++) await store.fail!('employee-test');
      assert.equal((await store.failures!('employee-test'))?.count, 5);
      assert.equal((await createPostgresStore(pool).failures!('employee-test'))?.count, 5);
      await store.resetFailures!('employee-test');
      assert.equal(await store.failures!('employee-test'), null);
    } finally {
      if (pool) await pool.end();
      await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await root.end();
    }
  },
);
