import { handleState } from '@/lib/api';
import { authServer, authorizedEmail } from '@/lib/auth/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    if (process.env.DATABASE_URL) {
      const { data: session } = await authServer().getSession();
      if (!session?.user)
        return Response.json(
          { code: 'SIGN_IN_REQUIRED', error: 'Connectez-vous pour accéder au restaurant.' },
          { status: 401, headers: { 'Cache-Control': 'no-store' } },
        );
      if (!authorizedEmail(session.user.email) || !session.user.emailVerified)
        return Response.json(
          { code: 'ACCESS_DENIED', error: 'Ce compte n’a pas accès au restaurant.' },
          { status: 403, headers: { 'Cache-Control': 'no-store' } },
        );
      const { postgresStore } = await import('@/lib/postgres');
      const response = await handleState(request, postgresStore());
      if (response.status === 200) {
        const data = await response.json();
        return Response.json(
          { ...data, user: { email: session.user.email, name: session.user.name } },
          { status: 200, headers: response.headers },
        );
      }
      return response;
    }
    if (process.env.VERCEL)
      return Response.json(
        {
          code: 'DATABASE_NOT_CONFIGURED',
          error: 'La base de données du restaurant n’est pas encore configurée.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    const host = new URL(request.url).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
      return Response.json({ error: 'Accès local uniquement.' }, { status: 403 });
    const { sqliteStore } = await import('@/lib/sqlite');
    return handleState(request, sqliteStore);
  } catch (e) {
    console.error('Restaurant API:', e instanceof Error ? e.message : 'erreur');
    return Response.json(
      {
        code: 'SERVER_UNAVAILABLE',
        error: 'La connexion à la base du restaurant a échoué. Réessayez dans un instant.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
export const GET = handle;
export const POST = handle;
