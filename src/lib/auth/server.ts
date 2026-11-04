import { createNeonAuth } from '@neon/auth/next/server';
let instance: ReturnType<typeof createNeonAuth> | undefined;
export function authServer() {
  if (!instance) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret) throw new Error('Configuration de connexion manquante.');
    instance = createNeonAuth({ baseUrl, cookies: { secret } });
  }
  return instance;
}
export function authorizedEmail(email: string) {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase());
}
