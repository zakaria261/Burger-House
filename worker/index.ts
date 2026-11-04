import { handleState, type Store } from '../src/lib/api';
import { type Mode, type State } from '../src/lib/model';
import assets from './assets.generated.json';
import { changes, metadata, pack, unpack, type RecordRow } from '../src/lib/records';
interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
interface Env {
  DB: {
    prepare(sql: string): Statement;
    batch(queries: Statement[]): Promise<{ meta: { changes: number } }[]>;
  };
}
const types: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  png: 'image/png',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  txt: 'text/plain',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
};
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const u = new URL(request.url);
    // Sites keeps this deployment owner-private and authenticates visitors at its gateway.
    // API access requires the visitor identity supplied by that gateway.
    if (u.pathname === '/api/state') {
      if (!request.headers.get('oai-authenticated-user-id'))
        return Response.json(
          { error: 'Connectez-vous pour accéder à votre espace.' },
          { status: 401, headers: { 'Cache-Control': 'no-store' } },
        );
      const store: Store = {
        async failures(key) {
          return env.DB.prepare('SELECT count, until FROM clock_attempts WHERE id = ?')
            .bind(key)
            .first<{ count: number; until: number }>();
        },
        async fail(key) {
          const now = Date.now();
          await env.DB.prepare(
            'INSERT INTO clock_attempts (id,count,until) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count = CASE WHEN until > ? THEN count+1 ELSE 1 END, until = CASE WHEN until > ? THEN until ELSE excluded.until END',
          )
            .bind(key, now + 900000, now, now)
            .run();
        },
        async resetFailures(key) {
          await env.DB.prepare('DELETE FROM clock_attempts WHERE id = ?').bind(key).run();
        },
        async revision(mode) {
          const r = await env.DB.prepare('SELECT revision FROM app_state WHERE mode = ?')
            .bind(mode)
            .first<{ revision: number }>();
          return r?.revision ?? null;
        },
        async read(mode: Mode) {
          const r = await env.DB.prepare('SELECT data, revision FROM app_state WHERE mode = ?')
            .bind(mode)
            .first<{ data: string; revision: number }>();
          if (!r) return null;
          const rows = await env.DB.prepare(
            'SELECT kind,id,data FROM app_records WHERE mode = ? ORDER BY rowid',
          )
            .bind(mode)
            .all<RecordRow>();
          return { state: unpack(r.data, rows.results), revision: r.revision };
        },
        async insert(mode: Mode, state: State) {
          const token = crypto.randomUUID();
          const queries = [
            env.DB.prepare(
              'INSERT OR IGNORE INTO app_state(mode,revision,data,token) VALUES (?,0,?,?)',
            ).bind(mode, metadata(state), token),
            ...pack(state).map((r) =>
              env.DB.prepare(
                'INSERT INTO app_records(mode,kind,id,data) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM app_state WHERE mode = ? AND token = ?)',
              ).bind(mode, r.kind, r.id, r.data, mode, token),
            ),
          ];
          await env.DB.batch(queries);
        },
        async update(mode: Mode, revision: number, state: State) {
          const previous = await store.read(mode);
          if (!previous || previous.revision !== revision) return false;
          const diff = changes(previous.state, state);
          const token = crypto.randomUUID();
          const queries = [
            env.DB.prepare(
              'UPDATE app_state SET data = ?, revision = revision + 1, token = ? WHERE mode = ? AND revision = ?',
            ).bind(metadata(state), token, mode, revision),
            ...diff.put.map((r) =>
              env.DB.prepare(
                'INSERT INTO app_records(mode,kind,id,data) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM app_state WHERE mode = ? AND token = ?) ON CONFLICT(mode,kind,id) DO UPDATE SET data = excluded.data',
              ).bind(mode, r.kind, r.id, r.data, mode, token),
            ),
            ...diff.remove.map((r) =>
              env.DB.prepare(
                'DELETE FROM app_records WHERE mode = ? AND kind = ? AND id = ? AND EXISTS (SELECT 1 FROM app_state WHERE mode = ? AND token = ?)',
              ).bind(mode, r.kind, r.id, mode, token),
            ),
          ];
          const result = await env.DB.batch(queries);
          return result[0].meta.changes === 1;
        },
      };
      return handleState(request, store);
    }
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response('Méthode interdite', { status: 405 });
    const key = u.pathname === '/' ? '/index.html' : u.pathname;
    const base64 =
      (assets as Record<string, string>)[key] ?? (assets as Record<string, string>)[`${key}.html`];
    if (!base64) return new Response('Page introuvable', { status: 404 });
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const ext = key.split('.').pop() ?? 'html';
    const contentType =
      key === '/' || (!ext.includes('/') && !key.includes('.'))
        ? 'text/html; charset=utf-8'
        : (types[ext] ?? 'application/octet-stream');
    const headers = new Headers({
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cache-Control': key.startsWith('/_next/static/')
        ? 'public,max-age=31536000,immutable'
        : key === '/sw.js'
          ? 'no-cache'
          : 'private,no-cache',
    });
    return new Response(request.method === 'HEAD' ? null : bytes, { headers });
  },
};
