import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL est requis pour les migrations.');
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(724401)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of readdirSync('migrations/postgres')
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync('migrations/postgres/' + name, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = await client.query('SELECT checksum FROM app_migrations WHERE name = $1', [
      name,
    ]);
    if (previous.rowCount) {
      if (previous.rows[0].checksum !== checksum)
        throw new Error('Une migration déjà appliquée a été modifiée : ' + name);
      continue;
    }
    await client.query(sql);
    await client.query('INSERT INTO app_migrations(name,checksum) VALUES ($1,$2)', [
      name,
      checksum,
    ]);
    console.log('Migration appliquée : ' + name);
  }
  await client.query('COMMIT');
  console.log('Schéma Postgres à jour.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('Migration annulée :', e instanceof Error ? e.message : 'erreur SQL');
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
