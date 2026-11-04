import { after } from 'next/server';
import { authenticate } from '@/lib/auth/principal';
import { databasePool } from '@/lib/postgres';
import { isSameOrigin } from '@/lib/origin';
import { CLOCK_EVENTS, dispatchPush, pushConfig, queueTest, validSubscription } from '@/lib/push';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  if (!process.env.DATABASE_URL)
    return Response.json(
      { error: 'Notifications disponibles sur l’espace en ligne.' },
      { status: 503 },
    );
  try {
    if (request.method !== 'GET' && !isSameOrigin(request))
      return Response.json({ error: 'Origine refusée.' }, { status: 403 });
    const principal = await authenticate(request);
    if (!principal) return Response.json({ error: 'Connexion requise.' }, { status: 401 });
    const reply = (data: unknown, status = 200) =>
      principal.finish(Response.json(data, { status }));
    const config = pushConfig(principal.user.email);
    const db = databasePool();
    if (request.method === 'DELETE') {
      await db.query('DELETE FROM push_subscriptions WHERE device_id=$1', [principal.deviceId]);
      return reply({ success: true });
    }
    if (request.method === 'GET') {
      const subs = await db.query('SELECT events FROM push_subscriptions WHERE device_id=$1', [
        principal.deviceId,
      ]);
      return reply({
        ...config,
        subscribed: !!subs.rowCount,
        events: subs.rows[0]?.events ?? CLOCK_EVENTS,
      });
    }
    if (!config.canSubscribe)
      return reply(
        {
          error: config.recipientConfigured
            ? 'Connectez-vous avec le compte de Douwi.'
            : 'L’adresse de Douwi sera renseignée prochainement.',
        },
        403,
      );
    const raw = await request.text();
    if (raw.length > 5000) return reply({ error: 'Envoi trop volumineux.' }, 413);
    const body = JSON.parse(raw);
    if (body.type === 'test') {
      // Throttled to one test per minute per device.
      const recent = await db.query(
        "SELECT 1 FROM push_deliveries p JOIN push_subscriptions s ON s.id=p.subscription_id WHERE s.device_id=$1 AND p.payload->>'title'='Burger House · Douwi' AND p.available_at>now()-interval '1 minute' LIMIT 1",
        [principal.deviceId],
      );
      if (recent.rowCount)
        return reply({ error: 'Patientez une minute avant un autre test.' }, 429);
      await queueTest(db, principal.deviceId);
    } else {
      if (
        !validSubscription(body.subscription) ||
        !Array.isArray(body.events) ||
        !body.events.length ||
        body.events.some((x: unknown) => !CLOCK_EVENTS.includes(x as (typeof CLOCK_EVENTS)[number]))
      )
        return reply({ error: 'Abonnement invalide.' }, 400);
      const sub = body.subscription;
      await db.query(
        `INSERT INTO push_subscriptions(id,device_id,owner_email,endpoint,keys,events) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)
        ON CONFLICT(endpoint) DO UPDATE SET device_id=EXCLUDED.device_id,keys=EXCLUDED.keys,events=EXCLUDED.events WHERE push_subscriptions.owner_email=EXCLUDED.owner_email`,
        [
          principal.deviceId,
          principal.user.email,
          sub.endpoint,
          JSON.stringify(sub.keys),
          JSON.stringify(body.events),
        ],
      );
    }
    after(async () => {
      try {
        await dispatchPush();
      } catch {
        console.error('Push: livraison différée.');
      }
    });
    return reply({ success: true });
  } catch {
    return Response.json(
      { error: 'Impossible de modifier les notifications. Réessayez.' },
      { status: 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
