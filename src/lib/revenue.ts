import { Entry, INCOME_CATEGORIES, Period, csv, today } from './model';

export type StatementRow = {
  key: string;
  label: string;
  detail: string;
  channels: Record<string, number>;
  total: number;
  count: number;
};
export type Statement = {
  title: string;
  channels: string[];
  rows: StatementRow[];
  totals: Record<string, number>;
  total: number;
  activeRows: number;
  best?: StatementRow;
};

const fmt = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'Europe/Paris' }).format(
    new Date(value + 'T12:00:00Z'),
  );
const capital = (s: string) => s.charAt(0).toLocaleUpperCase('fr') + s.slice(1);

/** Builds the per-channel revenue statement: one row per day of a month, or per month of a year. */
export function revenueStatement(
  entries: Entry[],
  date: string,
  period: Period,
  now = today(),
): Statement {
  const income = entries.filter((e) => e.type === 'income' && !e.voidedAt);
  const known = new Set<string>(INCOME_CATEGORIES);
  const hasOther = income.some((e) => !known.has(e.category));
  const channels: string[] = [...INCOME_CATEGORIES, ...(hasOther ? ['Autres'] : [])];
  const keys: { key: string; label: string; detail: string }[] = [];
  if (period === 'day')
    keys.push({
      key: date,
      label: fmt(date, { day: 'numeric' }),
      detail: fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    });
  else if (period === 'month') {
    const month = date.slice(0, 7);
    const last = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
    ).getUTCDate();
    for (let d = 1; d <= last; d++) {
      const key = `${month}-${String(d).padStart(2, '0')}`;
      if (key > now) break;
      keys.push({ key, label: String(d), detail: fmt(key, { weekday: 'short' }).replace('.', '') });
    }
  } else {
    const year = date.slice(0, 4);
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      if (key > now.slice(0, 7)) break;
      keys.push({ key, label: capital(fmt(key + '-01', { month: 'long' })), detail: year });
    }
  }
  const rows = keys.map(({ key, label, detail }) => {
    const row: StatementRow = {
      key,
      label,
      detail,
      channels: Object.fromEntries(channels.map((c) => [c, 0])),
      total: 0,
      count: 0,
    };
    for (const e of income) {
      if (!e.date.startsWith(key)) continue;
      const c = known.has(e.category) ? e.category : 'Autres';
      row.channels[c] += e.amount;
      row.total += e.amount;
      row.count++;
    }
    return row;
  });
  const totals = Object.fromEntries(
    channels.map((c) => [c, rows.reduce((a, r) => a + r.channels[c], 0)]),
  );
  const total = rows.reduce((a, r) => a + r.total, 0);
  const best = rows.reduce<StatementRow | undefined>(
    (b, r) => (r.total > (b?.total ?? 0) ? r : b),
    undefined,
  );
  return {
    title:
      period === 'day'
        ? capital(fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
        : period === 'month'
          ? capital(fmt(date, { month: 'long', year: 'numeric' }))
          : `Année ${date.slice(0, 4)}`,
    channels,
    rows,
    totals,
    total,
    activeRows: rows.filter((r) => r.total > 0).length,
    best,
  };
}

const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

/** CSV laid out like a cash register report, readable directly in Excel (French locale). */
export function statementCsv(s: Statement, period: Period) {
  const first = period === 'year' ? 'Mois' : 'Jour';
  return csv([
    ['Burger House · Relevé des recettes', s.title],
    [],
    [first, period === 'year' ? 'Année' : 'Date', ...s.channels, 'Total'],
    ...s.rows.map((r) => [
      r.label,
      period === 'year'
        ? r.detail
        : fmt(r.key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      ...s.channels.map((c) => euros(r.channels[c])),
      euros(r.total),
    ]),
    [],
    ['TOTAL', '', ...s.channels.map((c) => euros(s.totals[c])), euros(s.total)],
    [
      'Part',
      '',
      ...s.channels.map((c) =>
        s.total ? `${Math.round((s.totals[c] / s.total) * 1000) / 10} %` : '0 %',
      ),
      '100 %',
    ],
    ...(period !== 'day' && s.activeRows
      ? [
          [
            period === 'year' ? 'Moyenne par mois actif' : 'Moyenne par jour ouvert',
            '',
            ...s.channels.map((c) => euros(Math.round(s.totals[c] / s.activeRows))),
            euros(Math.round(s.total / s.activeRows)),
          ],
        ]
      : []),
  ]);
}
