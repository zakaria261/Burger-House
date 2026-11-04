export type Mode = 'live';
export type Period = 'day' | 'month' | 'year';
export type Tab = 'overview' | 'ledger' | 'team' | 'notebook' | 'settings';
export const CATEGORIES = [
  'Ingrédients',
  'Salaires',
  'Emballages',
  'Loyer & charges',
  'Énergie',
  'Équipement',
  'Autres',
] as const;
export const PAYMENTS = ['Carte bancaire', 'Espèces', 'Plateforme', 'Virement'] as const;
export type Entry = {
  id: string;
  type: 'income' | 'expense';
  title: string;
  amount: number;
  category: string;
  payment: string;
  date: string;
  supplier: string;
  note: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  createdAt: string;
  voidedAt?: string;
};
export type Employee = {
  id: string;
  name: string;
  role: string;
  color: string;
  hourlyCost: number;
  active: boolean;
  pinHash?: string;
};
export type Shift = {
  id: string;
  employeeId: string;
  startedAt: string;
  endedAt?: string;
  pauseStartedAt?: string;
  pauseMs: number;
};
export type Note = {
  id: string;
  title: string;
  body: string;
  category: 'Service' | 'À commander' | 'Équipe';
  done: boolean;
  createdAt: string;
};
export type Audit = { id: string; text: string; at: string };
export type State = {
  entries: Entry[];
  employees: Employee[];
  shifts: Shift[];
  notes: Note[];
  audit: Audit[];
  goal: number;
  requestIds: string[];
};
export type Snapshot = { state: State; revision: number; user?: { email: string; name?: string } };
export type Action =
  | { type: 'entry.add'; entry: Omit<Entry, 'id' | 'createdAt' | 'voidedAt'> }
  | { type: 'entry.void'; id: string }
  | { type: 'employee.add'; name: string; role: string; hourlyCost: number; pin: string }
  | { type: 'employee.archive'; id: string }
  | { type: 'clock'; employeeId: string; pin: string; event: 'in' | 'pause' | 'resume' | 'out' }
  | { type: 'note.add'; title: string; body: string; category: Note['category'] }
  | { type: 'note.toggle'; id: string }
  | { type: 'goal'; amount: number };
export const money = (cents: number, decimals = true) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: decimals ? 2 : 0,
    minimumFractionDigits: decimals ? 2 : 0,
  }).format(cents / 100);
export function today(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function addDays(value: string, days: number) {
  const d = new Date(value + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function inPeriod(date: string, selected: string, period: Period) {
  return period === 'day'
    ? date === selected
    : period === 'month'
      ? date.slice(0, 7) === selected.slice(0, 7)
      : date.slice(0, 4) === selected.slice(0, 4);
}
export function totals(entries: Entry[]) {
  return entries
    .filter((e) => !e.voidedAt)
    .reduce(
      (a, e) => {
        a[e.type] += e.amount;
        return a;
      },
      { income: 0, expense: 0 },
    );
}
export function shiftMs(s: Shift, now = Date.now()) {
  const end = s.endedAt ? Date.parse(s.endedAt) : now;
  const currentPause = s.pauseStartedAt ? end - Date.parse(s.pauseStartedAt) : 0;
  return Math.max(0, end - Date.parse(s.startedAt) - s.pauseMs - currentPause);
}
export function duration(ms: number) {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
export function periodShiftMs(s: Shift, selected: string, period: Period, now = Date.now()) {
  const start =
    period === 'day'
      ? selected
      : period === 'month'
        ? selected.slice(0, 7) + '-01'
        : selected.slice(0, 4) + '-01-01';
  const finish =
    period === 'day'
      ? addDays(start, 1)
      : period === 'month'
        ? (() => {
            const d = new Date(start + 'T12:00:00Z');
            d.setUTCMonth(d.getUTCMonth() + 1);
            return d.toISOString().slice(0, 10);
          })()
        : `${Number(start.slice(0, 4)) + 1}-01-01`;
  // Work sessions are attributed to the Paris calendar day on which the shift starts.
  return today(new Date(s.startedAt)) >= start && today(new Date(s.startedAt)) < finish
    ? shiftMs(s, now)
    : 0;
}
export function csv(rows: (string | number)[][]) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((v) => {
            const s = String(v);
            return '"' + (/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
          })
          .join(';'),
      )
      .join('\r\n')
  );
}
