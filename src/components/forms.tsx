'use client';
import { useState } from 'react';
import { Plus, Trash2, LockKeyhole, ArrowRight, Check, ShoppingBasket } from 'lucide-react';
import {
  Action,
  CATEGORIES,
  Entry,
  Employee,
  Note,
  PAYMENTS,
  Shift,
  money,
  today,
} from '@/lib/model';
import { Avatar } from './ui';
type Props = { submit: (action: Action) => Promise<boolean>; busy: boolean; error: string };
function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p className="form-error" role="alert">
      {message}
    </p>
  ) : null;
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
            payment: String(f.get('payment')),
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
            type === 'income' ? 'Ex. Service du midi' : 'Ex. Livraison de produits frais'
          }
          required
          maxLength={100}
        />
      </label>
      <div className="form-grid">
        <label>
          Catégorie
          <select name="category">
            {(type === 'expense' ? CATEGORIES : ['Sur place', 'À emporter', 'Livraison']).map(
              (v) => (
                <option key={v}>{v}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Date
          <input name="date" type="date" defaultValue={today()} max={today()} required />
        </label>
      </div>
      <div className="form-grid">
        <label>
          Mode de paiement
          <select name="payment">
            {PAYMENTS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          {type === 'expense' ? 'Fournisseur / salarié' : 'Référence'}
          <input
            name="supplier"
            placeholder={type === 'expense' ? 'Nom du fournisseur' : 'Facultatif'}
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
  demo,
}: {
  employee: Employee;
  shift?: Shift;
  event: 'in' | 'pause' | 'resume' | 'out';
  demo: boolean;
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
      {demo && (
        <p className="demo-pin">
          Mode démonstration · code : <strong>1234</strong>
        </p>
      )}
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
