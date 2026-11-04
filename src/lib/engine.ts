import {
  Action,
  State,
  today,
  PAYMENTS,
  CATEGORIES,
  INCOME_CATEGORIES,
  Shift,
  ShiftTimes,
} from './model';
export class ValidationError extends Error {}
const check = (ok: unknown, message: string) => {
  if (!ok) throw new ValidationError(message);
};
const text = (v: unknown, max = 200) => {
  check(
    typeof v === 'string' && v.trim().length > 0 && v.length <= max,
    'Un champ est manquant ou trop long.',
  );
  return (v as string).trim();
};
const cents = (n: unknown, allowZero = false) => {
  check(
    typeof n === 'number' && Number.isSafeInteger(n) && n >= (allowZero ? 0 : 1) && n <= 100000000,
    'Le montant doit être positif et exprimé au centime.',
  );
  return n as number;
};
export async function hashPin(pin: string, employeeId: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bytes = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode('burger-house:' + employeeId),
      iterations: 100000,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return (
    'pbkdf2:' +
    Array.from(new Uint8Array(bytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}
async function verifyPin(pin: string, employee: State['employees'][number]) {
  if (employee.pinHash?.startsWith('pbkdf2:'))
    return (await hashPin(pin, employee.id)) === employee.pinHash;
  // Upgrade records created by the first local preview after a successful verification.
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`burger-house:${employee.id}:${pin}`),
  );
  const legacy = Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (legacy !== employee.pinHash) return false;
  employee.pinHash = await hashPin(pin, employee.id);
  return true;
}
export async function applyAction(
  previous: State,
  action: Action,
  now = new Date(),
  actor = 'Responsable',
): Promise<State> {
  const s = structuredClone(previous);
  const at = now.toISOString();
  let message = '';
  switch (action.type) {
    case 'entry.add': {
      const e = action.entry;
      check(e && ['income', 'expense'].includes(e.type), 'Type d’écriture invalide.');
      text(e.title, 100);
      cents(e.amount);
      check(
        /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
          !Number.isNaN(Date.parse(e.date)) &&
          new Date(e.date).toISOString().slice(0, 10) === e.date &&
          e.date <= today(now),
        'Choisissez une date valide, aujourd’hui ou dans le passé.',
      );
      if (e.type === 'income') {
        check(
          INCOME_CATEGORIES.includes(e.category as (typeof INCOME_CATEGORIES)[number]),
          'Choisissez CB, Mypos, Espèces ou Uber pour cette recette.',
        );
        check(e.payment === e.category, 'Le canal de recette et le paiement doivent correspondre.');
      } else {
        check(
          PAYMENTS.includes(e.payment as (typeof PAYMENTS)[number]),
          'Mode de paiement invalide.',
        );
        check(
          CATEGORIES.includes(e.category as (typeof CATEGORIES)[number]),
          'Catégorie de dépense invalide.',
        );
      }
      check(
        typeof e.note === 'string' &&
          e.note.length <= 2000 &&
          typeof e.supplier === 'string' &&
          e.supplier.length <= 100,
        'Description trop longue.',
      );
      check(Array.isArray(e.items) && e.items.length <= 30, 'Trop de lignes.');
      e.items.forEach((i) => {
        text(i.name, 100);
        check(
          Number.isFinite(i.quantity) && i.quantity > 0 && i.quantity <= 100000,
          'Quantité invalide.',
        );
        cents(i.unitPrice);
      });
      if (e.items.length)
        check(
          e.items.reduce((a, i) => a + Math.round(i.quantity * i.unitPrice), 0) === e.amount,
          'Le total des lignes ne correspond pas au montant.',
        );
      s.entries.unshift({ ...e, title: e.title.trim(), id: crypto.randomUUID(), createdAt: at });
      message = `${e.type === 'income' ? 'Recette' : 'Dépense'} ajoutée : ${e.title.trim()}`;
      break;
    }
    case 'entry.void': {
      const e = s.entries.find((e) => e.id === action.id);
      check(e && !e.voidedAt, 'Cette écriture est introuvable ou déjà annulée.');
      e!.voidedAt = at;
      message = `Écriture annulée : ${e!.title}`;
      break;
    }
    case 'employee.add': {
      text(action.name, 80);
      text(action.role, 80);
      cents(action.hourlyCost);
      check(/^\d{4,6}$/.test(action.pin), 'Le code doit contenir 4 à 6 chiffres.');
      const id = crypto.randomUUID();
      s.employees.push({
        id,
        name: action.name.trim(),
        role: action.role.trim(),
        color: ['lime', 'peach', 'blue', 'violet'][s.employees.length % 4],
        hourlyCost: action.hourlyCost,
        active: true,
        pinHash: await hashPin(action.pin, id),
      });
      message = `Salarié ajouté : ${action.name}`;
      break;
    }
    case 'employee.archive': {
      const e = s.employees.find((e) => e.id === action.id);
      check(e, 'Salarié introuvable.');
      check(
        !s.shifts.some((x) => x.employeeId === action.id && !x.endedAt),
        'Terminez le service avant d’archiver ce salarié.',
      );
      e!.active = false;
      message = `Salarié archivé : ${e!.name}`;
      break;
    }
    case 'clock': {
      const employee = s.employees.find((e) => e.id === action.employeeId && e.active);
      check(employee, 'Salarié introuvable.');
      check(
        /^\d{4,6}$/.test(action.pin) && (await verifyPin(action.pin, employee!)),
        'Code de pointage incorrect.',
      );
      const shift = s.shifts.find((x) => x.employeeId === employee!.id && !x.endedAt);
      if (action.event === 'in') {
        check(!shift, 'Un service est déjà en cours.');
        s.shifts.unshift({
          id: crypto.randomUUID(),
          employeeId: employee!.id,
          startedAt: at,
          pauseMs: 0,
        });
      } else {
        check(shift, 'Aucun service en cours.');
        if (action.event === 'pause') {
          check(!shift!.pauseStartedAt, 'Une pause est déjà en cours.');
          shift!.pauseStartedAt = at;
        } else if (action.event === 'resume') {
          check(shift!.pauseStartedAt, 'Aucune pause en cours.');
          shift!.pauseMs += now.getTime() - Date.parse(shift!.pauseStartedAt!);
          delete shift!.pauseStartedAt;
        } else if (action.event === 'out') {
          if (shift!.pauseStartedAt) {
            shift!.pauseMs += now.getTime() - Date.parse(shift!.pauseStartedAt);
            delete shift!.pauseStartedAt;
          }
          shift!.endedAt = at;
        } else throw new ValidationError('Action de pointage invalide.');
      }
      message = `${employee!.name} · ${{ in: 'début du service', pause: 'début de pause', resume: 'reprise du service', out: 'fin du service' }[action.event]}`;
      break;
    }
    case 'shift.correct':
    case 'shift.add': {
      const previousShift =
        action.type === 'shift.correct' ? s.shifts.find((x) => x.id === action.id) : undefined;
      check(action.type !== 'shift.correct' || previousShift, 'Pointage introuvable.');
      const employeeId =
        previousShift?.employeeId ?? (action.type === 'shift.add' ? action.employeeId : '');
      const employee = s.employees.find((e) => e.id === employeeId);
      check(employee, 'Salarié introuvable.');
      const reason = text(action.reason, 500);
      check(reason.length >= 5, 'Précisez le motif de la correction (5 caractères minimum).');
      const timestamp = (value: unknown) => {
        check(
          typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
          'Horaire invalide.',
        );
        const n = Date.parse(value as string);
        check(
          Number.isFinite(n) && new Date(n).toISOString() === value && n <= now.getTime(),
          'Les horaires doivent être dans le passé.',
        );
        return n;
      };
      const start = timestamp(action.startedAt);
      const end = action.endedAt ? timestamp(action.endedAt) : now.getTime();
      check(end > start, 'Le départ doit être après l’arrivée.');
      check(
        Number.isFinite(action.pauseMinutes) &&
          action.pauseMinutes >= 0 &&
          Number.isSafeInteger(Math.round(action.pauseMinutes * 60000)) &&
          Math.abs(action.pauseMinutes * 60000 - Math.round(action.pauseMinutes * 60000)) < 0.001,
        'Durée de pause invalide.',
      );
      // For an open, currently paused shift, the field represents completed pauses only.
      const pauseStartedAt = !action.endedAt ? previousShift?.pauseStartedAt : undefined;
      check(
        !pauseStartedAt || Date.parse(pauseStartedAt) >= start,
        'L’arrivée doit précéder la pause en cours.',
      );
      check(
        action.pauseMinutes * 60000 + (pauseStartedAt ? end - Date.parse(pauseStartedAt) : 0) <=
          end - start,
        'Les pauses dépassent la durée du service.',
      );
      check(
        !s.shifts.some(
          (x) =>
            x.id !== previousShift?.id &&
            x.employeeId === employeeId &&
            start < (x.endedAt ? Date.parse(x.endedAt) : Infinity) &&
            (action.endedAt ? end : Infinity) > Date.parse(x.startedAt),
        ),
        'Ces horaires chevauchent un autre service du salarié.',
      );
      const times = (x: Shift): ShiftTimes => ({
        startedAt: x.startedAt,
        endedAt: x.endedAt,
        pauseStartedAt: x.pauseStartedAt,
        pauseMs: x.pauseMs,
      });
      const after: ShiftTimes = {
        startedAt: new Date(start).toISOString(),
        endedAt: action.endedAt ? new Date(end).toISOString() : undefined,
        pauseStartedAt,
        pauseMs: Math.round(action.pauseMinutes * 60000),
      };
      const correction = {
        at,
        actor,
        reason,
        before: previousShift ? times(previousShift) : null,
        after,
      };
      if (previousShift) {
        Object.assign(previousShift, after);
        previousShift.corrections = [...(previousShift.corrections ?? []), correction];
      } else
        s.shifts.unshift({
          id: crypto.randomUUID(),
          employeeId,
          ...after,
          corrections: [correction],
        });
      message = `${employee!.name} · pointage ${previousShift ? 'corrigé' : 'ajouté'} par ${actor} : ${reason}`;
      break;
    }
    case 'note.add':
      check(['Service', 'À commander', 'Équipe'].includes(action.category), 'Catégorie invalide.');
      text(action.title, 120);
      check(typeof action.body === 'string' && action.body.length <= 3000, 'Note trop longue.');
      s.notes.unshift({
        id: crypto.randomUUID(),
        title: action.title.trim(),
        body: action.body,
        category: action.category,
        done: false,
        createdAt: at,
      });
      message = `Note ajoutée : ${action.title}`;
      break;
    case 'note.toggle': {
      const n = s.notes.find((n) => n.id === action.id);
      check(n, 'Note introuvable.');
      n!.done = !n!.done;
      message = `Note ${n!.done ? 'terminée' : 'réouverte'} : ${n!.title}`;
      break;
    }
    case 'goal':
      s.goal = cents(action.amount);
      message = 'Objectif quotidien modifié';
      break;
    default:
      throw new ValidationError('Action inconnue.');
  }
  s.audit.unshift({ id: crypto.randomUUID(), text: message, at });
  s.audit = s.audit.slice(0, 300);
  return s;
}
export function publicState(s: State): State {
  return { ...s, employees: s.employees.map(({ pinHash: _, ...e }) => e), requestIds: [] };
}
export async function initialState(): Promise<State> {
  return { entries: [], employees: [], shifts: [], notes: [], audit: [], goal: 0, requestIds: [] };
}
