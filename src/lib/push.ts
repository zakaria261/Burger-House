import webpush from 'web-push';
import { randomUUID } from 'node:crypto';
import type { PoolClient, Pool } from 'pg';
import type { Action, State } from './model';
import { databasePool } from './postgres';
import { authorizedEmail } from './auth/server';
export const CLOCK_EVENTS = ['in', 'pause', 'resume', 'out'] as const;
export function pushRecipients() {
  return [
    ...new Set(
      [
        process.env.PUSH_RECIPIENT_EMAIL ?? '',
        ...(process.env.PUSH_RECIPIENT_EMAILS ?? '').split(','),
      ]
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email && authorizedEmail(email)),
    ),
  ];
}
export function pushConfig(email: string) {
  const recipients = pushRecipients();
  const configured =
    recipients.length > 0 && !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
  return {
    recipientConfigured: configured,
    canSubscribe: configured && recipients.includes(email.trim().toLowerCase()),
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  };
}
export function validSubscription(value: unknown): value is webpush.PushSubscription {
  const v = value as webpush.PushSubscription | undefined;
  if (!v || typeof v.endpoint !== 'string' || v.endpoint.length > 2000) return false;
  try {
    const u = new URL(v.endpoint);
    const host = u.hostname;
    const allowed =
      host === 'fcm.googleapis.com' ||
      host === 'android.googleapis.com' ||
      host === 'web.push.apple.com' ||
      host.endsWith('.push.apple.com') ||
      host.endsWith('.push.services.mozilla.com') ||
      host.endsWith('.notify.windows.com');
    if (u.protocol !== 'https:' || u.port || u.username || u.password || !allowed) return false;
  } catch {
    return false;
  }
  return (
    typeof v.keys?.auth === 'string' &&
    /^[A-Za-z0-9_-]{22}={0,2}$/.test(v.keys.auth) &&
    typeof v.keys?.p256dh === 'string' &&
    /^[A-Za-z0-9_-]{87}={0,2}$/.test(v.keys.p256dh)
  );
}
export async function enqueueClock(client: PoolClient, state: State, action?: Action) {
  if (action?.type !== 'clock') return;
  const recipients = pushRecipients();
  if (!recipients.length || !pushConfig(recipients[0]).recipientConfigured) return;
  const employee = state.employees.find((e) => e.id === action.employeeId);
  const audit = state.audit[0];
  const labels = {
    in: 'a commencé son service',
    pause: 'est en pause',
    resume: 'a repris son service',
    out: 'a terminé son service',
  };
  const payload = {
    title: 'Burger House · Équipe',
    body: `${employee?.name ?? 'Un salarié'} ${labels[action.event]}.`,
    eventId: audit.id,
    at: audit.at,
    url: '/?tab=team',
  };
  await client.query(
    `INSERT INTO push_deliveries(id,event_id,subscription_id,payload)
    SELECT gen_random_uuid(),$1,s.id,$2 FROM push_subscriptions s JOIN device_sessions d ON d.id=s.device_id
    WHERE s.owner_email=ANY($3::text[]) AND d.revoked_at IS NULL AND s.events ? $4
    ON CONFLICT(event_id,subscription_id) DO NOTHING`,
    [audit.id, JSON.stringify(payload), recipients, action.event],
  );
}
export async function dispatchPush(db: Pool = databasePool(), sender = webpush.sendNotification) {
  const recipients = pushRecipients();
  if (!recipients.length || !pushConfig(recipients[0]).recipientConfigured) return;
  // A lease permits safe retries after a crashed function. Expired shifts are never replayed days later.
  await db.query(
    "UPDATE push_deliveries SET failed_at=now() WHERE delivered_at IS NULL AND failed_at IS NULL AND (attempts>=6 OR available_at < now()-interval '1 day')",
  );
  const claimed = await db.query(
    `WITH pending AS (
    SELECT p.id FROM push_deliveries p JOIN push_subscriptions s ON s.id=p.subscription_id JOIN device_sessions d ON d.id=s.device_id
    WHERE p.delivered_at IS NULL AND p.failed_at IS NULL AND p.available_at<=now() AND p.attempts<6 AND s.owner_email=ANY($1::text[]) AND d.revoked_at IS NULL
    ORDER BY p.available_at FOR UPDATE OF p SKIP LOCKED LIMIT 8
  ) UPDATE push_deliveries p SET attempts=p.attempts+1,available_at=now()+interval '2 minutes' FROM pending WHERE p.id=pending.id
    RETURNING p.id,p.subscription_id,p.payload`,
    [recipients],
  );
  await Promise.allSettled(
    claimed.rows.map(async (row) => {
      const sub = await db.query(
        `SELECT s.endpoint,s.keys FROM push_subscriptions s JOIN device_sessions d ON d.id=s.device_id WHERE s.id=$1 AND d.revoked_at IS NULL AND s.owner_email=ANY($2::text[])`,
        [row.subscription_id, recipients],
      );
      if (!sub.rowCount) return;
      try {
        await sender(sub.rows[0], JSON.stringify(row.payload), {
          TTL: 3600,
          urgency: 'high',
          timeout: 8000,
          vapidDetails: {
            subject: process.env.VAPID_SUBJECT || 'https://burger-house-one-tau.vercel.app',
            publicKey: process.env.VAPID_PUBLIC_KEY!,
            privateKey: process.env.VAPID_PRIVATE_KEY!,
          },
        });
        await db.query('UPDATE push_deliveries SET delivered_at=now() WHERE id=$1', [row.id]);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410)
          await db.query('DELETE FROM push_subscriptions WHERE id=$1', [row.subscription_id]);
        else if (status === 400 || status === 413)
          await db.query('UPDATE push_deliveries SET failed_at=now() WHERE id=$1', [row.id]);
        // Network errors keep the leased delivery for a subsequent visit; clock data stays committed.
      }
    }),
  );
}
export async function queueTest(db: Pool, deviceId: string) {
  const result = await db.query(
    `INSERT INTO push_deliveries(id,event_id,subscription_id,payload) SELECT gen_random_uuid(),$1,id,$2 FROM push_subscriptions WHERE device_id=$3`,
    [
      randomUUID(),
      JSON.stringify({
        title: 'Burger House · Notifications',
        test: true,
        body: 'Les notifications sont activées sur ce téléphone.',
        url: '/?tab=team',
        at: new Date().toISOString(),
      }),
      deviceId,
    ],
  );
  return !!result.rowCount;
}
