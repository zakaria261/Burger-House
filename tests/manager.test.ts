import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyAction } from '../src/lib/engine';
import { shiftMs, totals } from '../src/lib/model';
import { parisCandidates, parisInput, parisToISO } from '../src/lib/paris-time';
import { validSubscription, pushConfig, pushRecipients } from '../src/lib/push';
const now = new Date('2026-11-04T20:00:00Z');
async function team() {
  return applyAction(
    await initialState(),
    { type: 'employee.add', name: 'Équipier test', role: 'Cuisine', hourlyCost: 1800, pin: '4321' },
    now,
  );
}
test('le responsable ajoute un pointage oublié et conserve chaque correction signée', async () => {
  let s = await team();
  const action = {
    type: 'shift.add' as const,
    employeeId: s.employees[0].id,
    startedAt: '2026-11-03T22:00:00.000Z',
    endedAt: '2026-11-04T02:00:00.000Z',
    pauseMinutes: 30,
    reason: 'Pointage oublié, confirmé avec le salarié',
  };
  s = await applyAction(s, action, now, 'Douwi');
  assert.equal(shiftMs(s.shifts[0]), 3.5 * 3600000);
  assert.equal(s.shifts[0].corrections?.[0].before, null);
  s = await applyAction(
    s,
    {
      ...action,
      type: 'shift.correct',
      id: s.shifts[0].id,
      endedAt: '2026-11-04T03:00:00.000Z',
      reason: 'Départ vérifié avec le salarié',
    },
    now,
    'douwi@example.com',
  );
  assert.equal(shiftMs(s.shifts[0]), 4.5 * 3600000);
  assert.equal(s.shifts[0].corrections?.length, 2);
  assert.equal(s.shifts[0].corrections?.[1].before?.endedAt, action.endedAt);
  assert.equal(s.shifts[0].corrections?.[1].actor, 'douwi@example.com');
  await assert.rejects(applyAction(s, action, now), /chevauchent/);
  await assert.rejects(
    applyAction(s, { ...action, startedAt: '2026-11-04T21:00:00.000Z' }, now),
    /passé/,
  );
  await assert.rejects(
    applyAction(s, { ...action, startedAt: '2026-02-30T12:00:00.000Z' }, now),
    /passé/,
  );
  await assert.rejects(applyAction(s, { ...action, reason: '' }, now), /champ/);
  await assert.rejects(applyAction(s, { ...action, pauseMinutes: 999 }, now), /pauses/);
});
test('corriger une arrivée conserve la pause en cours et empêche deux services ouverts', async () => {
  let s = await team();
  const employeeId = s.employees[0].id;
  s = await applyAction(
    s,
    { type: 'clock', employeeId, pin: '4321', event: 'in' },
    new Date('2026-11-04T12:00:00Z'),
  );
  s = await applyAction(
    s,
    { type: 'clock', employeeId, pin: '4321', event: 'pause' },
    new Date('2026-11-04T13:00:00Z'),
  );
  s = await applyAction(
    s,
    {
      type: 'shift.correct',
      id: s.shifts[0].id,
      startedAt: '2026-11-04T11:00:00.000Z',
      pauseMinutes: 0,
      reason: 'Arrivée une heure plus tôt',
    },
    now,
    'Douwi',
  );
  assert.equal(s.shifts[0].pauseStartedAt, '2026-11-04T13:00:00.000Z');
  assert.equal(shiftMs(s.shifts[0], +now), 2 * 3600000);
  await assert.rejects(
    applyAction(
      s,
      {
        type: 'shift.add',
        employeeId,
        startedAt: '2026-11-04T10:00:00.000Z',
        pauseMinutes: 0,
        reason: 'Service oublié',
      },
      now,
    ),
    /chevauchent/,
  );
  s = await applyAction(
    s,
    {
      type: 'shift.correct',
      id: s.shifts[0].id,
      startedAt: '2026-11-04T11:00:00.000Z',
      endedAt: '2026-11-04T14:00:00.000Z',
      pauseMinutes: 60,
      reason: 'Départ oublié après la pause',
    },
    now,
  );
  assert.equal(s.shifts[0].pauseStartedAt, undefined);
  assert.equal(shiftMs(s.shifts[0]), 2 * 3600000);
});
test('les horaires restent en heure de Paris, y compris aux changements d’heure', () => {
  assert.equal(parisInput('2026-11-04T12:00:00.000Z'), '2026-11-04T13:00');
  assert.equal(parisToISO('2026-07-01T13:00'), '2026-07-01T11:00:00.000Z');
  assert.equal(parisCandidates('2026-03-29T02:30').length, 0);
  assert.equal(parisCandidates('2026-10-25T02:30').length, 2);
  assert.throws(() => parisToISO('2026-10-25T02:30'), /passage/);
  assert.equal(parisToISO('2026-10-25T02:30', '1'), '2026-10-25T01:30:00.000Z');
  assert.equal(
    parisToISO('2026-11-04T13:00', '', '2026-11-04T12:00:26.123Z'),
    '2026-11-04T12:00:26.123Z',
  );
});
test('les destinataires Push incluent Zakaria et le futur compte de Douwi sans ouvrir les autres comptes', () => {
  const names = [
    'ADMIN_EMAILS',
    'PUSH_RECIPIENT_EMAIL',
    'PUSH_RECIPIENT_EMAILS',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.ADMIN_EMAILS = 'zakaria_rahou@yahoo.fr,douwi@example.com,autre@example.com';
    process.env.PUSH_RECIPIENT_EMAILS =
      ' ZAKARIA_RAHOU@yahoo.fr,zakaria_rahou@yahoo.fr,intrus@example.com';
    delete process.env.PUSH_RECIPIENT_EMAIL;
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    assert.deepEqual(pushRecipients(), ['zakaria_rahou@yahoo.fr']);
    assert.equal(pushConfig('zakaria_rahou@yahoo.fr').canSubscribe, true);
    assert.equal(pushConfig('autre@example.com').canSubscribe, false);
    process.env.PUSH_RECIPIENT_EMAIL = 'douwi@example.com';
    assert.equal(pushConfig('douwi@example.com').canSubscribe, true);
    assert.equal(pushConfig('zakaria_rahou@yahoo.fr').canSubscribe, true);
    assert.equal(pushConfig('intrus@example.com').canSubscribe, false);
    delete process.env.VAPID_PRIVATE_KEY;
    assert.equal(pushConfig('zakaria_rahou@yahoo.fr').canSubscribe, false);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
test('les abonnements Push acceptent uniquement les services reconnus', () => {
  const keys = { auth: 'a'.repeat(22), p256dh: 'a'.repeat(87) };
  assert.ok(validSubscription({ endpoint: 'https://web.push.apple.com/test', keys }));
  for (const endpoint of [
    'http://web.push.apple.com/test',
    'https://localhost/api',
    'https://web.push.apple.com.evil.test/a',
    'https://user@web.push.apple.com/a',
    'https://web.push.apple.com:8443/a',
  ])
    assert.equal(validSubscription({ endpoint, keys }), false);
});
test('le gain net suit les dépenses réelles, annulations exclues', () => {
  const { income, expense } = totals([
    { type: 'income', amount: 10000 },
    { type: 'expense', amount: 6500 },
    { type: 'expense', amount: 5000, voidedAt: now.toISOString() },
  ] as Parameters<typeof totals>[0]);
  assert.equal(income - expense, 3500);
});
