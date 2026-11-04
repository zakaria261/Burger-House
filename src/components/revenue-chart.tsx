'use client';
import { useId, useMemo, useState } from 'react';
import { Entry, Period, addDays, money, totals } from '@/lib/model';
const label = (date: string, period: Period, long = false) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    ...(period === 'year'
      ? { month: long ? 'long' : 'short' }
      : { day: 'numeric', month: long ? 'long' : 'short' }),
  }).format(new Date(date + 'T12:00:00Z'));
export default function RevenueChart({
  entries,
  date,
  period,
}: {
  entries: Entry[];
  date: string;
  period: Period;
}) {
  const id = useId().replaceAll(':', '');
  const [selection, setSelection] = useState<number | null>(null);
  const points = useMemo(() => {
    const days = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
    const count = period === 'day' ? 7 : period === 'month' ? Math.ceil(days / 4) : 12;
    return Array.from({ length: count }, (_, i) => {
      const d =
        period === 'day'
          ? addDays(date, i - 6)
          : period === 'month'
            ? date.slice(0, 7) + `-${String(1 + i * 4).padStart(2, '0')}`
            : `${date.slice(0, 4)}-${String(i + 1).padStart(2, '0')}-01`;
      const list = entries.filter((e) =>
        period === 'day'
          ? e.date === d
          : period === 'month'
            ? e.date >= d && e.date < addDays(d, 4) && e.date.slice(0, 7) === d.slice(0, 7)
            : e.date.slice(0, 7) === d.slice(0, 7),
      );
      return { date: d, ...totals(list) };
    });
  }, [date, period, entries]);
  const selected = selection === null ? points.length - 1 : Math.min(points.length - 1, selection);
  const p = points[selected];
  const max = Math.max(...points.flatMap((p) => [p.income, p.expense]), 100);
  const coords = points.map((p, i) => ({
    x: 12 + (i * 476) / (points.length - 1),
    y: 140 - (p.income / max) * 111,
  }));
  const path = coords.reduce(
    (s, p, i) =>
      i === 0
        ? `M${p.x},${p.y}`
        : `${s} C${(coords[i - 1].x + p.x) / 2},${coords[i - 1].y} ${(coords[i - 1].x + p.x) / 2},${p.y} ${p.x},${p.y}`,
    '',
  );
  const expenseCoords = points.map((p, i) => ({
    x: coords[i].x,
    y: 140 - (p.expense / max) * 111,
  }));
  const expensePath = expenseCoords.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  return (
    <div className={`revenue-chart ${selection !== null ? 'chart-inspecting' : ''}`}>
      <div className="chart-top">
        <span>
          {selection === null
            ? period === 'day'
              ? 'Les 7 derniers jours'
              : period === 'month'
                ? 'Par période de 4 jours'
                : 'Évolution mensuelle'
            : label(p.date, period, true)}
        </span>
        <strong className="chart-legend">
          {selection === null ? (
            <>
              <span>
                <i />
                Recettes
              </span>
              <span className="expense-key">
                <i />
                Dépenses
              </span>
            </>
          ) : (
            <span>Net {money(p.income - p.expense)}</span>
          )}
        </strong>
      </div>
      <div
        className="chart-interaction"
        role="slider"
        tabIndex={0}
        aria-label="Explorer les recettes, dépenses et gains nets"
        aria-valuemin={0}
        aria-valuemax={points.length - 1}
        aria-valuenow={selected}
        aria-valuetext={`${label(p.date, period, true)} : recettes ${money(p.income)}, dépenses ${money(p.expense)}, gain net ${money(p.income - p.expense)}`}
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            setSelection(
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? points.length - 1
                  : Math.max(
                      0,
                      Math.min(points.length - 1, selected + (e.key === 'ArrowRight' ? 1 : -1)),
                    ),
            );
          }
        }}
        onPointerMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          setSelection(
            Math.max(
              0,
              Math.min(
                points.length - 1,
                Math.round(((e.clientX - b.left) / b.width) * (points.length - 1)),
              ),
            ),
          );
        }}
        onPointerLeave={() => setSelection(null)}
        onBlur={() => setSelection(null)}
      >
        <svg viewBox="0 0 500 159" aria-hidden="true">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity=".21" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[29, 84, 140].map((y) => (
            <line key={y} className="chart-grid-line" x1="12" x2="488" y1={y} y2={y} />
          ))}
          <path d={`${path} L488,150 L12,150Z`} fill={`url(#${id})`} />
          <path className="chart-line" d={path} />
          <path className="chart-line chart-expense-line" d={expensePath} />
          {selection !== null && (
            <line
              className="chart-selection-line"
              x1={coords[selected].x}
              x2={coords[selected].x}
              y1="15"
              y2="150"
            />
          )}
          {selection !== null && (
            <circle
              className="chart-expense-point"
              cx={expenseCoords[selected].x}
              cy={expenseCoords[selected].y}
              r="5"
            />
          )}
          <circle
            className="chart-current-point"
            cx={coords[selected].x}
            cy={coords[selected].y}
            r={selection === null ? 4 : 6}
          />
        </svg>
      </div>
      {selection !== null && (
        <div className="chart-readout">
          <span>
            Recettes <b>{money(p.income)}</b>
          </span>
          <span>
            Dépenses <b>{money(p.expense)}</b>
          </span>
        </div>
      )}
      <div className="chart-labels">
        {points.map((p, i) => (
          <span className={selection === i ? 'selected' : ''} key={p.date}>
            {label(p.date, period)}
          </span>
        ))}
      </div>
    </div>
  );
}
