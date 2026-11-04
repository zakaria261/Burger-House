import { Action, State, today, addDays, PAYMENTS, CATEGORIES } from './model';
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
      check(
        PAYMENTS.includes(e.payment as (typeof PAYMENTS)[number]),
        'Mode de paiement invalide.',
      );
      check(
        e.type === 'income'
          ? ['Sur place', 'À emporter', 'Livraison'].includes(e.category)
          : CATEGORIES.includes(e.category as (typeof CATEGORIES)[number]),
        'Catégorie invalide.',
      );
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
export async function initialState(demo: boolean, now = new Date()): Promise<State> {
  const s: State = {
    entries: [],
    employees: [],
    shifts: [],
    notes: [],
    audit: [],
    goal: 150000,
    requestIds: [],
  };
  if (!demo) return s;
  const names = [
    ['Adam Benali', 'Responsable', 'lime', 1850],
    ['Sarah Martin', 'Équipière polyvalente', 'peach', 1600],
    ['Yanis Amrani', 'Cuisine', 'blue', 1650],
    ['Inès Robert', 'Accueil & caisse', 'violet', 1550],
  ] as const;
  for (let i = 0; i < names.length; i++) {
    const [name, role, color, hourlyCost] = names[i];
    const id = `demo-employee-${i}`;
    s.employees.push({
      id,
      name,
      role,
      color,
      hourlyCost,
      active: true,
      pinHash: await hashPin('1234', id),
    });
  }
  const d = today(now);
  for (let i = 0; i < 65; i++) {
    const date = addDays(d, -i);
    const scale = i === 0 ? 1 : 0.65 + ((i * 17) % 65) / 100;
    const entries: [string, 'income' | 'expense', number, string, string, string][] = [
      ['Service du midi', 'income', 86500, 'Sur place', 'Carte bancaire', ''],
      ['Commandes à emporter', 'income', 38650, 'À emporter', 'Espèces', ''],
      ['Livraisons du jour', 'income', 21800, 'Livraison', 'Plateforme', ''],
      ['Produits frais & viande', 'expense', 24680, 'Ingrédients', 'Virement', 'Fournisseur démo'],
      [
        'Pains burger & sauces',
        'expense',
        8950,
        'Ingrédients',
        'Carte bancaire',
        'Fournisseur démo',
      ],
      [
        'Emballages à emporter',
        'expense',
        4500,
        'Emballages',
        'Carte bancaire',
        'Fournisseur démo',
      ],
    ];
    if (i % 7 === 2)
      entries.push([
        'Salaires & charges versés',
        'expense',
        85000,
        'Salaires',
        'Virement',
        'Équipe',
      ]);
    if (date.endsWith('-01'))
      entries.push([
        'Loyer du restaurant',
        'expense',
        145000,
        'Loyer & charges',
        'Virement',
        'Bailleur',
      ]);
    entries.forEach(([title, type, amount, category, payment, supplier], j) =>
      s.entries.push({
        id: `demo-entry-${i}-${j}`,
        type,
        title,
        amount: Math.round(amount * scale),
        category,
        payment,
        supplier,
        date,
        note: 'Exemple de démonstration',
        items: [],
        createdAt: `${date}T${j < 3 ? '13' : '09'}:${j}0:00+01:00`,
      }),
    );
  }
  s.shifts = [
    {
      id: 'demo-shift-0',
      employeeId: s.employees[0].id,
      startedAt: new Date(now.getTime() - 8100000).toISOString(),
      pauseMs: 900000,
    },
    {
      id: 'demo-shift-1',
      employeeId: s.employees[1].id,
      startedAt: new Date(now.getTime() - 6300000).toISOString(),
      pauseMs: 0,
    },
    {
      id: 'demo-shift-2',
      employeeId: s.employees[2].id,
      startedAt: new Date(now.getTime() - 7200000).toISOString(),
      pauseStartedAt: new Date(now.getTime() - 600000).toISOString(),
      pauseMs: 0,
    },
  ];
  for (let i = 1; i <= 7; i++)
    s.employees.forEach((e, j) => {
      const start = new Date(`${addDays(d, -i)}T10:00:00+01:00`);
      s.shifts.push({
        id: `demo-history-${i}-${j}`,
        employeeId: e.id,
        startedAt: start.toISOString(),
        endedAt: new Date(+start + 7 * 3600000).toISOString(),
        pauseMs: 1800000,
      });
    });
  s.notes = [
    {
      id: 'demo-note-1',
      title: 'Préparer le service du soir',
      body: 'Vérifier la mise en place, les sauces maison et les emballages avant l’ouverture.',
      category: 'Service',
      done: false,
      createdAt: now.toISOString(),
    },
    {
      id: 'demo-note-2',
      title: 'Pains briochés à commander',
      body: 'Prévoir 120 pains pour la prochaine livraison. Confirmer la quantité avec l’équipe cuisine.',
      category: 'À commander',
      done: false,
      createdAt: now.toISOString(),
    },
    {
      id: 'demo-note-3',
      title: 'Une équipe, les mêmes réflexes',
      body: 'Penser à pointer le début et la fin de chaque service, ainsi que les pauses.',
      category: 'Équipe',
      done: false,
      createdAt: now.toISOString(),
    },
  ];
  return s;
}
