import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { createPostgresStore } from '../src/lib/postgres';
import { initialState, applyAction } from '../src/lib/engine';
import { createDevice, readDevice, revokeDevice } from '../src/lib/auth/device';
import { dispatchPush } from '../src/lib/push';
import webpush from 'web-push';
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
      for (const name of readdirSync('migrations/postgres').sort())
        await pool.query(readFileSync('migrations/postgres/' + name, 'utf8'));
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
      // Persistent credentials survive a new server connection, and logout revokes both session and push.
      const user = { id: 'test-user', email: 'douwi@example.com', name: 'Douwi' };
      const device = await createDevice(pool, user);
      assert.equal((await readDevice(pool, device.token))?.user.email, user.email);
      assert.equal(await readDevice(pool, device.token.slice(0, -2) + 'xx'), null);
      assert.notEqual(
        (await pool.query('SELECT secret_hash FROM device_sessions')).rows[0].secret_hash,
        device.token.split('.')[1],
      );
      const envKeys = [
        'ADMIN_EMAILS',
        'PUSH_RECIPIENT_EMAIL',
        'VAPID_PUBLIC_KEY',
        'VAPID_PRIVATE_KEY',
      ] as const;
      const old = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
      try {
        const keys = webpush.generateVAPIDKeys();
        process.env.ADMIN_EMAILS = user.email;
        process.env.PUSH_RECIPIENT_EMAIL = user.email;
        process.env.VAPID_PUBLIC_KEY = keys.publicKey;
        process.env.VAPID_PRIVATE_KEY = keys.privateKey;
        await pool.query(
          'INSERT INTO push_subscriptions(id,device_id,owner_email,endpoint,keys,events) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)',
          [
            device.id,
            user.email,
            'https://web.push.apple.com/test-only-no-delivery',
            JSON.stringify({ auth: 'a'.repeat(22), p256dh: 'a'.repeat(87) }),
            JSON.stringify(['in', 'out']),
          ],
        );
        const current = (await store.read('live'))!;
        const staff = await applyAction(current.state, {
          type: 'employee.add',
          name: 'Test isolé',
          role: 'Cuisine',
          hourlyCost: 1800,
          pin: '4321',
        });
        await store.update('live', current.revision, staff);
        const clock = {
          type: 'clock' as const,
          employeeId: staff.employees[0].id,
          pin: '4321',
          event: 'in' as const,
        };
        const clocked = await applyAction(staff, clock);
        assert.equal(await store.update('live', current.revision + 1, clocked, clock), true);
        assert.equal(await store.update('live', current.revision + 1, clocked, clock), false);
        assert.equal((await pool.query('SELECT count(*) FROM push_deliveries')).rows[0].count, '1');
        const sent: string[] = [];
        await dispatchPush(pool, async (_sub, payload) => {
          sent.push(String(payload));
          return { statusCode: 201, body: '', headers: {} };
        });
        assert.equal(sent.length, 1);
        assert.match(sent[0], /commencé son service/);
        await dispatchPush(pool, async () => {
          throw new Error('A delivered event must not be sent twice');
        });
        assert.equal(
          (await pool.query('SELECT count(*) FROM push_deliveries WHERE delivered_at IS NOT NULL'))
            .rows[0].count,
          '1',
        );
        // Transient network failures are retained; the lease prevents a second immediate send.
        const out = { ...clock, event: 'out' as const };
        const finished = await applyAction(clocked, out);
        await store.update('live', current.revision + 2, finished, out);
        await dispatchPush(pool, async () => {
          throw new Error('network test');
        });
        assert.equal(
          (await pool.query('SELECT attempts FROM push_deliveries WHERE delivered_at IS NULL'))
            .rows[0].attempts,
          1,
        );
        await dispatchPush(pool, async () => {
          throw new Error('Must respect lease');
        });
        assert.equal(
          (await pool.query('SELECT attempts FROM push_deliveries WHERE delivered_at IS NULL'))
            .rows[0].attempts,
          1,
        );
        await pool.query(
          "UPDATE push_deliveries SET available_at=now()-interval '1 second' WHERE delivered_at IS NULL",
        );
        await dispatchPush(pool, async () => {
          throw Object.assign(new Error('expired'), { statusCode: 410 });
        });
        assert.equal(
          (await pool.query('SELECT count(*) FROM push_subscriptions')).rows[0].count,
          '0',
        );
        await revokeDevice(pool, device.token);
        assert.equal(await readDevice(pool, device.token), null);
      } finally {
        for (const key of envKeys) {
          if (old[key] === undefined) delete process.env[key];
          else process.env[key] = old[key];
        }
      }
    } finally {
      if (pool) await pool.end();
      await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await root.end();
    }
  },
);
