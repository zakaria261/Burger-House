import {
  Action,
  State,
  today,
  PAYMENTS,
  CATEGORIES,
  INCOME_CATEGORIES,
  Shift,
  ShiftTimes,
  STOCK_CATEGORIES,
  STOCK_UNITS,
  STOCK_ZONES,
  LOSS_REASONS,
  StockItem,
  StockItemInput,
  StockMove,
  money,
} from './model';
import { formatQty, roundQty } from './inventory';
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
const day = (value: unknown, now: Date, allowFuture = false) => {
  check(
    typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value &&
      (allowFuture || value <= today(now)),
    allowFuture ? 'Date invalide.' : 'Choisissez une date valide, aujourd’hui ou dans le passé.',
  );
  return value as string;
};
const quantity = (n: unknown, allowZero = true, label = 'Quantité invalide.') => {
  check(
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000000 && (allowZero || n > 0),
    label,
  );
  return roundQty(n as number);
};
const MAX_STOCK_MOVES = 3000;
function stockInput(input: StockItemInput, now: Date): StockItemInput {
  check(input && typeof input === 'object', 'Article invalide.');
  const name = text(input.name, 80);
  check(
    STOCK_CATEGORIES.includes(input.category as (typeof STOCK_CATEGORIES)[number]),
    'Catégorie d’article invalide.',
  );
  check(STOCK_UNITS.includes(input.unit as (typeof STOCK_UNITS)[number]), 'Unité invalide.');
  check(
    STOCK_ZONES.includes(input.zone as (typeof STOCK_ZONES)[number]),
    'Zone de stockage invalide.',
  );
  check(
    typeof input.supplier === 'string' && input.supplier.length <= 60,
    'Nom du fournisseur trop long.',
  );
  const minQuantity = quantity(input.minQuantity, true, 'Seuil d’alerte invalide.');
  const parQuantity = quantity(input.parQuantity, true, 'Stock idéal invalide.');
  check(
    !parQuantity || parQuantity >= minQuantity,
    'Le stock idéal doit être supérieur ou égal au seuil d’alerte.',
  );
  check(
    typeof input.unitCost === 'number' &&
      Number.isSafeInteger(input.unitCost) &&
      input.unitCost >= 0 &&
      input.unitCost <= 10000000,
    'Coût unitaire invalide.',
  );
  return {
    name,
    category: input.category,
    unit: input.unit,
    zone: input.zone,
    supplier: input.supplier.trim(),
    minQuantity,
    parQuantity,
    unitCost: input.unitCost,
    expiresAt: input.expiresAt ? day(input.expiresAt, now, true) : undefined,
  };
}
function addMove(
  s: State,
  item: StockItem,
  kind: StockMove['kind'],
  delta: number,
  reason: string,
  at: string,
  actor: string,
  extra: Partial<StockMove> = {},
) {
  item.quantity = roundQty(item.quantity + delta);
  item.updatedAt = at;
  s.stockMoves.unshift({
    id: crypto.randomUUID(),
    itemId: item.id,
    kind,
    delta: roundQty(delta),
    after: item.quantity,
    unitCost: item.unitCost,
    reason,
    actor,
    at,
    ...extra,
  });
}
const activeItem = (s: State, id: unknown) => {
  const item = s.stock.find((i) => i.id === id && i.active);
  check(item, 'Article introuvable ou archivé.');
  return item!;
};
const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('fr') === b.trim().toLocaleLowerCase('fr');

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
  s.stock ??= [];
  s.stockMoves ??= [];
  const at = now.toISOString();
  let message = '';
  switch (action.type) {
    case 'entry.add': {
      const e = action.entry;
      check(e && ['income', 'expense'].includes(e.type), 'Type d’écriture invalide.');
      // A revenue is identified by its channel: the label is optional.
      if (e.type === 'income' && (typeof e.title !== 'string' || !e.title.trim()))
        e.title = String(e.category);
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
    case 'income.day': {
      const date = day(action.date, now);
      check(action.amounts && typeof action.amounts === 'object', 'Montants invalides.');
      const note = action.note ?? '';
      check(typeof note === 'string' && note.length <= 2000, 'Note trop longue.');
      const added: string[] = [];
      for (const channel of INCOME_CATEGORIES) {
        const amount = action.amounts[channel];
        if (amount === undefined || amount === 0) continue;
        cents(amount);
        s.entries.unshift({
          id: crypto.randomUUID(),
          type: 'income',
          title: channel,
          amount,
          category: channel,
          payment: channel,
          date,
          supplier: '',
          note,
          items: [],
          createdAt: at,
        });
        added.push(`${channel} ${money(amount)}`);
      }
      check(
        Object.keys(action.amounts).every((k) =>
          INCOME_CATEGORIES.includes(k as (typeof INCOME_CATEGORIES)[number]),
        ),
        'Canal de recette inconnu.',
      );
      check(added.length, 'Saisissez au moins un montant.');
      message = `Recettes du ${date.split('-').reverse().join('/')} : ${added.join(' · ')}`;
      break;
    }
    case 'stock.item.save': {
      const input = stockInput(action.item, now);
      check(
        !s.stock.some((i) => i.active && i.id !== action.id && sameName(i.name, input.name)),
        'Un article porte déjà ce nom.',
      );
      if (action.id) {
        const item = activeItem(s, action.id);
        Object.assign(item, input, { updatedAt: at });
        if (!input.expiresAt) delete item.expiresAt;
        message = `Article modifié : ${item.name}`;
      } else {
        check(s.stock.filter((i) => i.active).length < 500, 'Nombre maximal d’articles atteint.');
        const initial = quantity(action.initialQuantity ?? 0);
        const item: StockItem = {
          ...input,
          id: crypto.randomUUID(),
          quantity: 0,
          active: true,
          createdAt: at,
          updatedAt: at,
        };
        if (!item.expiresAt) delete item.expiresAt;
        s.stock.push(item);
        if (initial > 0) {
          addMove(s, item, 'count', initial, 'Stock initial', at, actor);
          item.lastCountedAt = at;
        }
        message = `Article ajouté : ${item.name}`;
      }
      break;
    }
    case 'stock.items.import': {
      check(Array.isArray(action.items) && action.items.length > 0, 'Aucun article sélectionné.');
      check(action.items.length <= 120, 'Trop d’articles en une fois.');
      check(
        s.stock.filter((i) => i.active).length + action.items.length <= 500,
        'Nombre maximal d’articles atteint.',
      );
      let count = 0;
      for (const raw of action.items) {
        const input = stockInput(raw, now);
        if (s.stock.some((i) => i.active && sameName(i.name, input.name))) continue;
        const item: StockItem = {
          ...input,
          id: crypto.randomUUID(),
          quantity: 0,
          active: true,
          createdAt: at,
          updatedAt: at,
        };
        if (!item.expiresAt) delete item.expiresAt;
        s.stock.push(item);
        const initial = quantity(raw.quantity ?? 0);
        if (initial > 0) {
          addMove(s, item, 'count', initial, 'Stock initial', at, actor);
          item.lastCountedAt = at;
        }
        count++;
      }
      check(count, 'Ces articles existent déjà dans l’inventaire.');
      message = `${count} article${count > 1 ? 's' : ''} ajouté${count > 1 ? 's' : ''} à l’inventaire`;
      break;
    }
    case 'stock.item.archive': {
      const item = activeItem(s, action.id);
      item.active = false;
      item.updatedAt = at;
      message = `Article archivé : ${item.name}`;
      break;
    }
    case 'stock.items.archive': {
      check(Array.isArray(action.ids) && action.ids.length > 0, 'Aucun article sélectionné.');
      check(action.ids.length <= 500, 'Trop d’articles en une fois.');
      check(
        new Set(action.ids).size === action.ids.length,
        'Un article est sélectionné deux fois.',
      );
      for (const id of action.ids) {
        const item = activeItem(s, id);
        item.active = false;
        item.updatedAt = at;
      }
      message = `${action.ids.length} article${action.ids.length > 1 ? 's' : ''} retiré${action.ids.length > 1 ? 's' : ''} de l’inventaire`;
      break;
    }
    case 'stock.move': {
      const item = activeItem(s, action.itemId);
      check(['in', 'out', 'loss'].includes(action.kind), 'Mouvement invalide.');
      const q = quantity(action.quantity, false, 'Indiquez une quantité positive.');
      let reason = '';
      if (action.kind === 'loss') {
        check(
          LOSS_REASONS.includes(action.reason as (typeof LOSS_REASONS)[number]),
          'Choisissez le motif de la perte.',
        );
        reason = action.reason!;
      } else {
        check(
          action.reason === undefined ||
            (typeof action.reason === 'string' && action.reason.length <= 200),
          'Commentaire trop long.',
        );
        reason = action.reason?.trim() ?? '';
      }
      if (action.kind === 'in') {
        if (action.unitCost !== undefined) {
          check(
            Number.isSafeInteger(action.unitCost) &&
              action.unitCost >= 0 &&
              action.unitCost <= 10000000,
            'Coût unitaire invalide.',
          );
          if (action.unitCost > 0) item.unitCost = action.unitCost;
        }
        if (action.expiresAt) item.expiresAt = day(action.expiresAt, now, true);
        addMove(s, item, 'in', q, reason || 'Réception', at, actor);
        message = `Réception : ${item.name} +${formatQty(q, item.unit)}`;
      } else {
        check(
          q <= roundQty(item.quantity),
          `Le stock enregistré est de ${formatQty(Math.max(0, item.quantity), item.unit)}. Faites un comptage pour le corriger.`,
        );
        addMove(s, item, action.kind, -q, reason || 'Sortie', at, actor);
        if (item.quantity <= 0) delete item.expiresAt;
        message = `${action.kind === 'loss' ? `Perte (${reason})` : 'Sortie'} : ${item.name} −${formatQty(q, item.unit)}`;
      }
      break;
    }
    case 'stock.count': {
      check(Array.isArray(action.lines) && action.lines.length > 0, 'Aucun article compté.');
      check(action.lines.length <= 500, 'Trop de lignes.');
      check(
        new Set(action.lines.map((l) => l.itemId)).size === action.lines.length,
        'Un article est compté deux fois.',
      );
      const batchId = crypto.randomUUID();
      let changed = 0;
      let value = 0;
      for (const line of action.lines) {
        const item = activeItem(s, line.itemId);
        const counted = quantity(line.quantity);
        const delta = roundQty(counted - item.quantity);
        item.lastCountedAt = at;
        item.updatedAt = at;
        if (delta !== 0) {
          addMove(s, item, 'count', delta, 'Comptage', at, actor, { batchId });
          value += Math.round(delta * item.unitCost);
          changed++;
        }
        if (item.quantity <= 0) delete item.expiresAt;
      }
      message = `Comptage : ${action.lines.length} article${action.lines.length > 1 ? 's' : ''}, ${changed} écart${changed > 1 ? 's' : ''}${value ? ` (${value > 0 ? '+' : '−'}${money(Math.abs(value))})` : ''}`;
      break;
    }
    case 'stock.receive': {
      const supplier = typeof action.supplier === 'string' ? action.supplier.trim() : '';
      check(supplier.length <= 60, 'Nom du fournisseur trop long.');
      const date = day(action.date, now);
      check(
        Array.isArray(action.lines) && action.lines.length > 0,
        'Ajoutez au moins un article reçu.',
      );
      check(action.lines.length <= 120, 'Trop de lignes.');
      check(
        new Set(action.lines.map((l) => l.itemId)).size === action.lines.length,
        'Un article apparaît deux fois dans la livraison.',
      );
      const note = action.note ?? '';
      check(typeof note === 'string' && note.length <= 2000, 'Note trop longue.');
      const batchId = crypto.randomUUID();
      const entryId = action.expense ? crypto.randomUUID() : undefined;
      const items: State['entries'][number]['items'] = [];
      let total = 0;
      for (const line of action.lines) {
        const item = activeItem(s, line.itemId);
        const q = quantity(line.quantity, false, `Quantité reçue invalide pour ${item.name}.`);
        check(
          Number.isSafeInteger(line.unitCost) && line.unitCost >= 0 && line.unitCost <= 10000000,
          `Prix invalide pour ${item.name}.`,
        );
        if (line.unitCost > 0) item.unitCost = line.unitCost;
        if (line.expiresAt) item.expiresAt = day(line.expiresAt, now, true);
        addMove(s, item, 'in', q, supplier ? `Livraison ${supplier}` : 'Livraison', at, actor, {
          batchId,
          entryId,
        });
        if (action.expense) {
          check(line.unitCost > 0, `Indiquez le prix de ${item.name} pour créer la dépense.`);
          items.push({ name: item.name, quantity: q, unitPrice: line.unitCost });
          total += Math.round(q * line.unitCost);
        }
      }
      if (action.expense) {
        check(
          CATEGORIES.includes(action.expense.category as (typeof CATEGORIES)[number]),
          'Catégorie de dépense invalide.',
        );
        check(
          PAYMENTS.includes(action.expense.payment as (typeof PAYMENTS)[number]),
          'Mode de paiement invalide.',
        );
        cents(total);
        s.entries.unshift({
          id: entryId!,
          type: 'expense',
          title: supplier ? `Livraison ${supplier}` : 'Livraison de marchandises',
          amount: total,
          category: action.expense.category,
          payment: action.expense.payment,
          date,
          supplier,
          note,
          items,
          createdAt: at,
        });
      }
      message = `Livraison${supplier ? ` ${supplier}` : ''} réceptionnée : ${action.lines.length} article${action.lines.length > 1 ? 's' : ''}${action.expense ? ` · dépense ${money(total)}` : ''}`;
      break;
    }
    default:
      throw new ValidationError('Action inconnue.');
  }
  s.audit.unshift({ id: crypto.randomUUID(), text: message, at });
  s.audit = s.audit.slice(0, 300);
  s.stockMoves = s.stockMoves.slice(0, MAX_STOCK_MOVES);
  return s;
}
export function publicState(s: State): State {
  return { ...s, employees: s.employees.map(({ pinHash: _, ...e }) => e), requestIds: [] };
}
export async function initialState(): Promise<State> {
  return {
    entries: [],
    employees: [],
    shifts: [],
    notes: [],
    audit: [],
    stock: [],
    stockMoves: [],
    goal: 0,
    requestIds: [],
  };
}
