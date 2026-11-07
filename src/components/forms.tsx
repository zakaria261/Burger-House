'use client';
import { useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  LockKeyhole,
  ArrowRight,
  Check,
  ShoppingBasket,
  CalendarDays,
  ChevronDown,
} from 'lucide-react';
import {
  Action,
  CATEGORIES,
  INCOME_CATEGORIES,
  Entry,
  Employee,
  Note,
  PAYMENTS,
  Shift,
  money,
  today,
} from '@/lib/model';
import { parisInput, parisCandidates, parisToISO } from '@/lib/paris-time';
import { Avatar, CategoryIcon } from './ui';
type Props = { submit: (action: Action) => Promise<boolean>; busy: boolean; error: string };
function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p className="form-error" role="alert">
      {message}
    </p>
  ) : null;
}
/** Parses a French amount ("12,5", "1 234,56") into cents, or null when invalid. */
export function parseEuros(value: string) {
  const v = value.replace(/[\s\u00a0\u202f€]/g, '').replace(',', '.');
  if (!v) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}
const CHANNEL_HINT: Record<string, string> = {
  CB: 'Terminal carte bancaire',
  Mypos: 'Terminal Mypos',
  Espèces: 'Caisse en espèces',
  Uber: 'Uber Eats',
};
export function IncomeForm({ submit, busy, error, entries }: Props & { entries: Entry[] }) {
  const [date, setDate] = useState(today());
  const [values, setValues] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState('');
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const parsed = INCOME_CATEGORIES.map((c) => parseEuros(values[c] ?? ''));
  const total = parsed.reduce<number>((a, v) => a + (v ?? 0), 0);
  const existing = useMemo(() => {
    const r: Record<string, number> = {};
    for (const e of entries)
      if (e.type === 'income' && !e.voidedAt && e.date === date)
        r[e.category] = (r[e.category] ?? 0) + e.amount;
    return r;
  }, [entries, date]);
  const existingTotal = Object.values(existing).reduce((a, v) => a + v, 0);
  const label =
    date === today()
      ? 'Aujourd’hui'
      : new Intl.DateTimeFormat('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: 'Europe/Paris',
        }).format(new Date(date + 'T12:00:00Z'));
  return (
    <form
      className="form income-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError('');
        if (parsed.some((v) => v === null)) {
          setLocalError('Un montant est mal saisi. Exemple : 125,50');
          return;
        }
        if (!total) {
          setLocalError('Saisissez au moins un montant.');
          return;
        }
        const amounts: Partial<Record<(typeof INCOME_CATEGORIES)[number], number>> = {};
        INCOME_CATEGORIES.forEach((c, i) => {
          if (parsed[i]) amounts[c] = parsed[i]!;
        });
        await submit({
          type: 'income.day',
          date,
          amounts,
          note: String(new FormData(e.currentTarget).get('note') ?? ''),
        });
      }}
    >
      <label className="income-date">
        <CalendarDays size={18} />
        <span>
          <small>Journée encaissée</small>
          {label}
        </span>
        <ChevronDown size={16} />
        <input
          type="date"
          aria-label="Date des recettes"
          value={date}
          max={today()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          required
        />
      </label>
      <div className="channel-inputs">
        {INCOME_CATEGORIES.map((c, i) => (
          <label
            key={c}
            className={`channel-input channel-${i} ${parsed[i] ? 'has-value' : ''} ${parsed[i] === null ? 'is-invalid' : ''}`}
          >
            <span className="channel-icon">
              <CategoryIcon category={c} size={20} />
            </span>
            <span className="channel-name">
              {c}
              <small>{existing[c] ? `Déjà saisi : ${money(existing[c])}` : CHANNEL_HINT[c]}</small>
            </span>
            <span className="channel-amount">
              <input
                ref={(el) => {
                  refs.current[i] = el;
                }}
                aria-label={`Montant ${c} en euros`}
                inputMode="decimal"
                enterKeyHint={i < INCOME_CATEGORIES.length - 1 ? 'next' : 'done'}
                placeholder="0,00"
                autoComplete="off"
                value={values[c] ?? ''}
                onChange={(e) => setValues({ ...values, [c]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && i < INCOME_CATEGORIES.length - 1) {
                    e.preventDefault();
                    refs.current[i + 1]?.focus();
                  }
                }}
              />
              <b>€</b>
            </span>
          </label>
        ))}
      </div>
      <div className="income-total">
        <span>
          Total à enregistrer
          {!!existingTotal && <small>Journée après saisie : {money(existingTotal + total)}</small>}
        </span>
        <strong>{money(total)}</strong>
      </div>
      <details className="income-note">
        <summary>Ajouter une note (facultatif)</summary>
        <textarea
          name="note"
          placeholder="Ex. Fermeture anticipée, fond de caisse…"
          maxLength={2000}
          rows={2}
        />
      </details>
      <ErrorMessage message={localError || error} />
      <button className="button button-primary full" disabled={busy || !total} type="submit">
        {busy ? 'Enregistrement…' : 'Enregistrer les recettes'}
        <Check size={18} />
      </button>
      <p className="field-help centered">
        Remplissez uniquement les canaux encaissés. Chaque canal est enregistré séparément.
      </p>
    </form>
  );
}
export function EntryForm({ type, submit, busy, error }: { type: Entry['type'] } & Props) {
  const [lines, setLines] = useState<{ name: string; quantity: string; unitPrice: string }[]>([]);
  const [amount, setAmount] = useState('');
  const total = lines.reduce(
    (sum, i) =>
      sum +
      Math.round(Number(i.quantity) * Math.round(Number(i.unitPrice.replace(',', '.')) * 100)),
    0,
  );
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await submit({
          type: 'entry.add',
          entry: {
            type,
            title: String(f.get('title')),
            amount: lines.length ? total : Math.round(Number(amount.replace(',', '.')) * 100),
            category: String(f.get('category')),
            payment: type === 'income' ? String(f.get('category')) : String(f.get('payment')),
            date: String(f.get('date')),
            supplier: String(f.get('supplier') ?? ''),
            note: String(f.get('note') ?? ''),
            items: lines.map((l) => ({
              name: l.name,
              quantity: Number(l.quantity),
              unitPrice: Math.round(Number(l.unitPrice.replace(',', '.')) * 100),
            })),
          },
        });
      }}
    >
      <div className={`amount-input ${type === 'income' ? 'positive' : ''}`}>
        <span>{type === 'income' ? 'Montant encaissé' : 'Montant de la dépense'}</span>
        <div>
          <input
            aria-label="Montant en euros"
            inputMode="decimal"
            placeholder="0,00"
            value={lines.length ? (total / 100).toFixed(2) : amount}
            readOnly={!!lines.length}
            onChange={(e) => setAmount(e.target.value)}
            required={!lines.length}
            pattern="[0-9]+([.,][0-9]{1,2})?"
          />
          <b>€</b>
        </div>
        <small>Montant total TTC · en euros</small>
      </div>
      <label>
        Libellé
        <input
          name="title"
          placeholder={
            type === 'income' ? 'Ex. Ventes du service du midi' : 'Ex. Livraison de produits frais'
          }
          required
          maxLength={100}
        />
      </label>
      <div className="form-grid">
        <label>
          {type === 'income' ? 'Encaissé par' : 'Catégorie de dépense'}
          <select name="category">
            {(type === 'income' ? INCOME_CATEGORIES : CATEGORIES).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input name="date" type="date" defaultValue={today()} max={today()} required />
        </label>
      </div>
      <div className="form-grid">
        {type === 'expense' && (
          <label>
            Mode de paiement
            <select name="payment">
              {PAYMENTS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          {type === 'expense' ? 'Fournisseur / salarié' : 'Référence'}
          <input
            name="supplier"
            placeholder={type === 'expense' ? 'Ex. Gfd, Gasoil, Carrefour…' : 'Facultatif'}
            maxLength={100}
          />
        </label>
      </div>
      {type === 'expense' && (
        <div className="line-items">
          <div className="form-section-title">
            <span>
              <ShoppingBasket size={16} /> Détail des achats
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => setLines([...lines, { name: '', quantity: '1', unitPrice: '' }])}
            >
              <Plus size={15} /> Une ligne
            </button>
          </div>
          {lines.map((l, i) => (
            <div className="line-item" key={i}>
              <input
                aria-label={`Article ${i + 1}`}
                placeholder="Article / ingrédient"
                required
                value={l.name}
                maxLength={100}
                onChange={(e) =>
                  setLines(lines.map((v, j) => (j === i ? { ...v, name: e.target.value } : v)))
                }
              />
              <input
                aria-label={`Quantité ${i + 1}`}
                type="number"
                min="0.001"
                step="0.001"
                required
                value={l.quantity}
                onChange={(e) =>
                  setLines(lines.map((v, j) => (j === i ? { ...v, quantity: e.target.value } : v)))
                }
              />
              <input
                aria-label={`Prix unitaire ${i + 1}`}
                placeholder="€/unité"
                inputMode="decimal"
                pattern="[0-9]+([.,][0-9]{1,2})?"
                required
                value={l.unitPrice}
                onChange={(e) =>
                  setLines(lines.map((v, j) => (j === i ? { ...v, unitPrice: e.target.value } : v)))
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Supprimer l’article ${i + 1}`}
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {!lines.length && (
            <p className="field-help">
              Ajoutez les ingrédients, quantités et prix unitaires pour garder une trace précise.
            </p>
          )}
          {!!lines.length && (
            <p className="line-total">
              Total des articles <strong>{money(total || 0)}</strong>
            </p>
          )}
        </div>
      )}
      <label>
        Note / référence du justificatif
        <textarea
          name="note"
          placeholder="Une précision utile pour retrouver cette écriture…"
          maxLength={2000}
          rows={2}
        />
      </label>
      <ErrorMessage message={error} />
      <button className="button button-primary full" disabled={busy} type="submit">
        {busy ? 'Enregistrement…' : `Enregistrer la ${type === 'income' ? 'recette' : 'dépense'}`}
        <Check size={18} />
      </button>
      <p className="field-help centered">
        Enregistrement horodaté. Toute annulation reste dans l’historique.
      </p>
    </form>
  );
}
export function EmployeeForm({ submit, busy, error }: Props) {
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await submit({
          type: 'employee.add',
          name: String(f.get('name')),
          role: String(f.get('role')),
          hourlyCost: Math.round(Number(f.get('cost')) * 100),
          pin: String(f.get('pin')),
        });
      }}
    >
      <label>
        Prénom et nom
        <input name="name" placeholder="Ex. Sarah Martin" maxLength={80} required />
      </label>
      <label>
        Poste
        <input name="role" placeholder="Ex. Équipière polyvalente" maxLength={80} required />
      </label>
      <label>
        Coût horaire estimé, charges comprises (€)
        <input
          name="cost"
          type="number"
          step="0.01"
          min="0.01"
          max="10000"
          placeholder="18,50"
          required
        />
      </label>
      <p className="field-help">
        Ce montant sert aux estimations. Il ne crée pas de dépense dans le registre.
      </p>
      <label>
        Code personnel de pointage
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4,6}"
          minLength={4}
          maxLength={6}
          autoComplete="new-password"
          placeholder="4 à 6 chiffres"
          required
        />
      </label>
      <div className="info-box">
        <LockKeyhole size={18} />
        <p>Communiquez ce code au salarié. Il est demandé à chaque pointage.</p>
      </div>
      <ErrorMessage message={error} />
      <button className="button button-primary full" disabled={busy}>
        {busy ? 'Enregistrement…' : 'Ajouter à l’équipe'}
        <Plus size={18} />
      </button>
    </form>
  );
}
export function ClockForm({
  employee,
  shift,
  event,
  submit,
  busy,
  error,
}: {
  employee: Employee;
  shift?: Shift;
  event: 'in' | 'pause' | 'resume' | 'out';
} & Props) {
  const [pin, setPin] = useState('');
  const labels = {
    in: 'Commencer mon service',
    pause: 'Commencer ma pause',
    resume: 'Reprendre mon service',
    out: 'Terminer mon service',
  };
  return (
    <form
      className="form clock-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit({ type: 'clock', employeeId: employee.id, pin, event });
      }}
    >
      <div className="clock-person">
        <Avatar name={employee.name} color={employee.color} />
        <h3>{employee.name}</h3>
        <p>{employee.role}</p>
      </div>
      <div className="clock-event">
        <span className={`status-dot ${event === 'out' ? 'muted-dot' : ''}`} />
        {labels[event]}
        <small>
          {new Intl.DateTimeFormat('fr-FR', {
            timeZone: 'Europe/Paris',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date())}
        </small>
      </div>
      {shift?.pauseStartedAt && event === 'out' && (
        <p className="field-help">La pause en cours sera déduite du temps travaillé.</p>
      )}
      <label className="pin-label">
        Votre code personnel
        <input
          type="password"
          aria-label="Code personnel"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{4,6}"
          minLength={4}
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="••••"
          required
        />
      </label>
      <ErrorMessage message={error} />
      <button className="button button-primary full" disabled={busy}>
        {busy ? 'Pointage…' : labels[event]}
        <ArrowRight size={18} />
      </button>
      <p className="field-help centered">
        <LockKeyhole size={12} /> Horodatage du serveur · pauses déduites
      </p>
    </form>
  );
}
export function NoteForm({ submit, busy, error }: Props) {
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({
          type: 'note.add',
          title: String(f.get('title')),
          body: String(f.get('body')),
          category: f.get('category') as Note['category'],
        });
      }}
    >
      <label>
        Titre
        <input name="title" placeholder="Une chose à ne pas oublier…" maxLength={120} required />
      </label>
      <label>
        Catégorie
        <select name="category">
          {['Service', 'À commander', 'Équipe'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        Votre note
        <textarea
          name="body"
          rows={5}
          placeholder="Les détails qui font la différence pour le prochain service."
          maxLength={3000}
        />
      </label>
      <ErrorMessage message={error} />
      <button className="button button-primary full" disabled={busy}>
        {busy ? 'Enregistrement…' : 'Ajouter au cahier'}
        <Plus size={18} />
      </button>
    </form>
  );
}

export function ShiftForm({
  employees,
  shift,
  submit,
  busy,
  error,
}: { employees: Employee[]; shift?: Shift } & Props) {
  const [start, setStart] = useState(shift ? parisInput(shift.startedAt) : '');
  const [end, setEnd] = useState(
    shift?.endedAt ? parisInput(shift.endedAt) : parisInput(new Date()),
  );
  const [closed, setClosed] = useState(!!shift?.endedAt || !shift);
  const [startOccurrence, setStartOccurrence] = useState('');
  const [endOccurrence, setEndOccurrence] = useState('');
  const initialPause = String(Math.round((shift?.pauseMs ?? 0) / 600) / 100);
  const [pause, setPause] = useState(initialPause);
  const [localError, setLocalError] = useState('');
  const dateTime = (
    value: string,
    set: (v: string) => void,
    occurrence: string,
    select: (v: string) => void,
    original?: string,
  ) => (
    <>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => {
          set(e.target.value);
          select('');
        }}
        max={parisInput(new Date())}
        min="2000-01-01T00:00"
        required
      />
      {parisCandidates(value).length > 1 && (!original || parisInput(original) !== value) && (
        <select
          aria-label="Passage lors du changement d’heure"
          value={occurrence}
          onChange={(e) => select(e.target.value)}
          required
        >
          <option value="">Choisir le passage…</option>
          <option value="0">Premier passage · heure d’été</option>
          <option value="1">Second passage · heure d’hiver</option>
        </select>
      )}
    </>
  );
  const formatTimes = (value: { startedAt: string; endedAt?: string; pauseMs: number } | null) =>
    value
      ? `${parisInput(value.startedAt).replace('T', ' à ')} → ${value.endedAt ? parisInput(value.endedAt).replace('T', ' à ') : 'En cours'} · ${Math.round(value.pauseMs / 60000)} min de pause`
      : 'Aucun pointage';
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        setLocalError('');
        try {
          const form = new FormData(e.currentTarget);
          const times = {
            startedAt: parisToISO(start, startOccurrence, shift?.startedAt),
            endedAt: closed ? parisToISO(end, endOccurrence, shift?.endedAt) : undefined,
            pauseMinutes: pause === initialPause && shift ? shift.pauseMs / 60000 : Number(pause),
            reason: String(form.get('reason')),
          };
          void submit(
            shift
              ? { type: 'shift.correct', id: shift.id, ...times }
              : { type: 'shift.add', employeeId: String(form.get('employeeId')), ...times },
          );
        } catch (err) {
          setLocalError((err as Error).message);
        }
      }}
    >
      <label>
        Salarié
        <select
          name="employeeId"
          defaultValue={shift?.employeeId ?? ''}
          disabled={!!shift}
          required
        >
          <option value="" disabled>
            Choisir un salarié
          </option>
          {employees
            .filter((e) => e.active || e.id === shift?.employeeId)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Arrivée · heure de Paris
        {dateTime(start, setStart, startOccurrence, setStartOccurrence, shift?.startedAt)}
      </label>
      <label className="check-field">
        <input
          type="checkbox"
          checked={closed}
          onChange={(e) => {
            setClosed(e.target.checked);
            if (e.target.checked && shift?.pauseStartedAt)
              setPause(
                String(
                  Math.round(
                    (shift.pauseMs + Date.now() - Date.parse(shift.pauseStartedAt)) / 600,
                  ) / 100,
                ),
              );
          }}
        />
        Service terminé
      </label>
      {closed && (
        <label>
          Départ · heure de Paris
          {dateTime(end, setEnd, endOccurrence, setEndOccurrence, shift?.endedAt)}
        </label>
      )}
      <label>
        {!closed && shift?.pauseStartedAt
          ? 'Pauses déjà terminées (minutes)'
          : 'Total des pauses (minutes)'}
        <input
          type="number"
          min="0"
          step="any"
          value={pause}
          onChange={(e) => setPause(e.target.value)}
          required
        />
      </label>
      {!closed && shift?.pauseStartedAt && (
        <p className="field-help">
          La pause en cours reste active. Elle sera déduite automatiquement à la reprise.
        </p>
      )}
      <label>
        Motif obligatoire
        <textarea
          name="reason"
          minLength={5}
          maxLength={500}
          rows={2}
          placeholder="Ex. : départ oublié, confirmé avec le salarié."
          required
        />
      </label>
      <div className="info-box">
        <LockKeyhole size={18} />
        <p>
          Modification du responsable. L’ancien horaire, le motif et votre compte seront conservés.
        </p>
      </div>
      <ErrorMessage message={localError || error} />
      <button className="button button-primary full" disabled={busy}>
        {busy ? 'Enregistrement…' : shift ? 'Enregistrer la correction' : 'Ajouter le pointage'}
        <Check size={18} />
      </button>
      {!!shift?.corrections?.length && (
        <div className="correction-history">
          <h3>Historique des corrections</h3>
          {[...shift.corrections].reverse().map((c, i) => (
            <details key={i}>
              <summary>
                {parisInput(c.at).replace('T', ' · ')} · {c.reason}
              </summary>
              <p>Par {c.actor}</p>
              <p>Avant : {formatTimes(c.before)}</p>
              <p>Après : {formatTimes(c.after)}</p>
            </details>
          ))}
        </div>
      )}
    </form>
  );
}
