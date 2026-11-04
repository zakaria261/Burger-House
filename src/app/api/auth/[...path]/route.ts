import { authServer, authorizedEmail } from '@/lib/auth/server';
import { cookieToken, deviceCookie, revokeDevice } from '@/lib/auth/device';
import { databasePool } from '@/lib/postgres';
import { isSameOrigin } from '@/lib/origin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const allowed = new Set([
  'get-session',
  'sign-out',
  'sign-in/email-otp',
  'email-otp/send-verification-otp',
]);
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, '');
  if (!allowed.has(path))
    return Response.json(
      { code: 'NOT_FOUND', message: 'Méthode de connexion indisponible.' },
      { status: 404 },
    );
  if (request.method === 'POST') {
    if (!isSameOrigin(request))
      return Response.json({ message: 'Origine refusée.' }, { status: 403 });
    const body = await request
      .clone()
      .json()
      .catch(() => null);
    if (body?.email && !authorizedEmail(body.email))
      return Response.json(
        { code: 'ACCESS_DENIED', message: 'Cette adresse n’est pas autorisée pour ce restaurant.' },
        { status: 403 },
      );
    if (path === 'email-otp/send-verification-otp' && body?.type !== 'sign-in')
      return Response.json(
        { message: 'Seuls les codes de connexion sont autorisés.' },
        { status: 403 },
      );
  }
  try {
    if (path === 'sign-out' && request.method === 'POST') {
      await revokeDevice(databasePool(), cookieToken(request));
      let response: Response;
      try {
        response = await authServer().handler().POST(request, context);
      } catch {
        response = Response.json({ success: true });
      }
      // Local credentials must be removed even when the provider session has expired.
      if (!response.ok) response = Response.json({ success: true });
      for (const cookie of request.headers.get('cookie')?.split(';') ?? []) {
        const name = cookie.trim().split('=')[0];
        if (/^__Secure-neon-auth\.[a-zA-Z0-9_.-]+$/.test(name))
          response.headers.append(
            'Set-Cookie',
            `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
          );
      }
      response.headers.append('Set-Cookie', deviceCookie('', true));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const methods = authServer().handler();
    const method = request.method as keyof typeof methods;
    const handler = methods[method];
    if (!handler) return new Response(null, { status: 405 });
    return handler(request, context);
  } catch {
    return Response.json(
      {
        code: 'AUTH_UNAVAILABLE',
        message: 'Le service de connexion est temporairement indisponible.',
      },
      { status: 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
