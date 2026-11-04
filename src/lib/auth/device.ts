import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
export type Principal = { id: string; email: string; name?: string };
export const DEVICE_COOKIE = '__Host-bh-device';
const age = 400 * 24 * 60 * 60;
export function cookieToken(request: Request) {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(DEVICE_COOKIE + '='))
    ?.slice(DEVICE_COOKIE.length + 1);
}
export function parseDeviceToken(token?: string) {
  if (!token || !/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [id, secret] = token.split('.');
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) return null;
  return { id, hash: createHash('sha256').update(secret).digest('hex') };
}
export function deviceCookie(token: string, clear = false) {
  return `${DEVICE_COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : age}`;
}
export async function createDevice(db: Pool, user: Principal) {
  const id = randomUUID();
  const token = id + '.' + randomBytes(32).toString('base64url');
  await db.query(
    'INSERT INTO device_sessions(id,secret_hash,user_id,email,name) VALUES ($1,$2,$3,$4,$5)',
    [id, parseDeviceToken(token)!.hash, user.id, user.email.toLowerCase(), user.name ?? null],
  );
  return { id, token };
}
export async function readDevice(db: Pool, token?: string) {
  const parsed = parseDeviceToken(token);
  if (!parsed) return null;
  const result = await db.query(
    'SELECT id,secret_hash,user_id,email,name FROM device_sessions WHERE id=$1 AND revoked_at IS NULL',
    [parsed.id],
  );
  const row = result.rows[0];
  if (
    !row ||
    row.secret_hash.length !== parsed.hash.length ||
    !timingSafeEqual(Buffer.from(row.secret_hash), Buffer.from(parsed.hash))
  )
    return null;
  await db.query(
    "UPDATE device_sessions SET last_used_at=now() WHERE id=$1 AND last_used_at < now() - interval '1 day'",
    [parsed.id],
  );
  return {
    deviceId: row.id as string,
    user: { id: row.user_id, email: row.email, name: row.name ?? undefined } as Principal,
  };
}
export async function revokeDevice(db: Pool, token?: string) {
  const device = await readDevice(db, token);
  if (!device) return;
  // Revocation also cancels pending notifications to this phone.
  await db.query('UPDATE device_sessions SET revoked_at=now() WHERE id=$1', [device.deviceId]);
  await db.query('DELETE FROM push_subscriptions WHERE device_id=$1', [device.deviceId]);
}
