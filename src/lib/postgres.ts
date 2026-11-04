import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import type { Store } from './api';
import type { Mode, State } from './model';
import { changes, metadata, pack, unpack, type RecordRow } from './records';
let pool: Pool | undefined;
export function databasePool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 15000,
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}
export function createPostgresStore(db: Pool): Store {
  return {
    async revision(mode) {
      const r = await db.query('SELECT revision FROM app_state WHERE mode = $1', [mode]);
      return r.rows[0]?.revision ?? null;
    },
    async read(mode: Mode) {
      const client = await db.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const meta = await client.query('SELECT revision,data FROM app_state WHERE mode = $1', [
          mode,
        ]);
        if (!meta.rowCount) {
          await client.query('COMMIT');
          return null;
        }
        const rows = await client.query(
          'SELECT kind,id,data FROM app_records WHERE mode = $1 ORDER BY recorded_order',
          [mode],
        );
        await client.query('COMMIT');
        return {
          revision: meta.rows[0].revision,
          state: unpack(
            JSON.stringify(meta.rows[0].data),
            rows.rows.map((r) => ({ ...r, data: JSON.stringify(r.data) })) as RecordRow[],
          ),
        };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async insert(mode: Mode, state: State) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          'INSERT INTO app_state(mode,revision,data,token) VALUES ($1,0,$2,$3) ON CONFLICT(mode) DO NOTHING',
          [mode, metadata(state), crypto.randomUUID()],
        );
        if (result.rowCount) {
          for (const row of pack(state))
            await client.query('INSERT INTO app_records(mode,kind,id,data) VALUES ($1,$2,$3,$4)', [
              mode,
              row.kind,
              row.id,
              row.data,
            ]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async update(mode: Mode, revision: number, state: State) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const meta = await client.query(
          'SELECT revision,data FROM app_state WHERE mode = $1 FOR UPDATE',
          [mode],
        );
        if (!meta.rowCount || meta.rows[0].revision !== revision) {
          await client.query('ROLLBACK');
          return false;
        }
        const rows = await client.query(
          'SELECT kind,id,data FROM app_records WHERE mode = $1 ORDER BY recorded_order',
          [mode],
        );
        const previous = unpack(
          JSON.stringify(meta.rows[0].data),
          rows.rows.map((r) => ({ ...r, data: JSON.stringify(r.data) })) as RecordRow[],
        );
        const diff = changes(previous, state);
        for (const r of diff.put)
          await client.query(
            'INSERT INTO app_records(mode,kind,id,data) VALUES ($1,$2,$3,$4) ON CONFLICT(mode,kind,id) DO UPDATE SET data = EXCLUDED.data',
            [mode, r.kind, r.id, r.data],
          );
        for (const r of diff.remove)
          await client.query('DELETE FROM app_records WHERE mode = $1 AND kind = $2 AND id = $3', [
            mode,
            r.kind,
            r.id,
          ]);
        await client.query(
          'UPDATE app_state SET revision = revision + 1, data = $1, token = $2 WHERE mode = $3',
          [metadata(state), crypto.randomUUID(), mode],
        );
        await client.query('COMMIT');
        return true;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async failures(key) {
      const r = await db.query('SELECT count,until FROM clock_attempts WHERE id = $1', [key]);
      return r.rowCount ? { count: r.rows[0].count, until: Number(r.rows[0].until) } : null;
    },
    async fail(key) {
      const now = Date.now();
      await db.query(
        'INSERT INTO clock_attempts(id,count,until) VALUES ($1,1,$2) ON CONFLICT(id) DO UPDATE SET count = CASE WHEN clock_attempts.until > $3 THEN clock_attempts.count+1 ELSE 1 END, until = CASE WHEN clock_attempts.until > $3 THEN clock_attempts.until ELSE EXCLUDED.until END',
        [key, now + 900000, now],
      );
    },
    async resetFailures(key) {
      await db.query('DELETE FROM clock_attempts WHERE id = $1', [key]);
    },
  };
}
export function postgresStore() {
  return createPostgresStore(databasePool());
}
