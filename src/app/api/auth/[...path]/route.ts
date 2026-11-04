import { authServer, authorizedEmail } from '@/lib/auth/server';
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
