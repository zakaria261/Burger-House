'use client';
import { FileSpreadsheet, Printer, Trophy } from 'lucide-react';
import { Period, money } from '@/lib/model';
import type { Statement } from '@/lib/revenue';
import { CategoryIcon } from './ui';

const short = (cents: number) =>
  cents
    ? new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        cents / 100,
      )
    : '—';
const share = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

export function RevenueStatement({
  statement: s,
  period,
  onExport,
  onPrint,
}: {
  statement: Statement;
  period: Period;
  onExport: () => void;
  onPrint: () => void;
}) {
  return (
    <section className="panel statement-panel">
      <header className="panel-header">
        <div>
          <h2>Relevé des recettes</h2>
          <p>
            {period === 'day'
              ? 'Encaissements de la journée, canal par canal.'
              : period === 'month'
                ? 'Chaque jour du mois, canal par canal, avec le total.'
                : 'Chaque mois de l’année, canal par canal, avec le total.'}
          </p>
        </div>
        <div className="statement-actions">
          <button className="button button-secondary" onClick={onExport}>
            <FileSpreadsheet size={16} />
            <span>Excel</span>
          </button>
          <button className="button button-secondary" onClick={onPrint}>
            <Printer size={16} />
            <span>PDF</span>
          </button>
        </div>
      </header>
      <div className="channel-totals">
        {s.channels.map((c, i) => (
          <div key={c} className={`channel-total channel-${i}`}>
            <span className="channel-icon">
              <CategoryIcon category={c} size={17} />
            </span>
            <span>{c}</span>
            <strong>{money(s.totals[c])}</strong>
            <small>{share(s.totals[c], s.total)} %</small>
            <i style={{ width: `${share(s.totals[c], s.total)}%` }} />
          </div>
        ))}
        <div className="channel-total channel-grand">
          <span>Total</span>
          <strong>{money(s.total)}</strong>
          <small>
            {period === 'day'
              ? `${s.rows[0]?.count ?? 0} encaissement${(s.rows[0]?.count ?? 0) > 1 ? 's' : ''}`
              : s.activeRows
                ? `Moyenne ${money(Math.round(s.total / s.activeRows), false)} / ${period === 'month' ? 'jour' : 'mois'}`
                : 'Aucune recette'}
          </small>
        </div>
      </div>
      {period !== 'day' && (
        <div
          className="statement-table"
          role="table"
          aria-label={`Relevé des recettes · ${s.title}`}
        >
          <div className="statement-row statement-head" role="row">
            <span role="columnheader">{period === 'month' ? 'Jour' : 'Mois'}</span>
            <span className="statement-cells">
              {s.channels.map((c) => (
                <span key={c} role="columnheader">
                  {c}
                </span>
              ))}
            </span>
            <span role="columnheader">Total</span>
          </div>
          {s.rows.map((r) => (
            <div
              key={r.key}
              role="row"
              className={`statement-row ${r.total ? '' : 'is-empty'} ${s.best?.key === r.key && s.activeRows > 1 ? 'is-best' : ''}`}
            >
              <span className="statement-day" role="cell">
                <b>{r.label}</b>
                <small>{period === 'month' ? r.detail : ''}</small>
                {s.best?.key === r.key && s.activeRows > 1 && (
                  <Trophy size={12} aria-label="Meilleur" />
                )}
              </span>
              <span className="statement-cells">
                {s.channels.map((c) => (
                  <span
                    key={c}
                    role="cell"
                    data-label={c}
                    className={r.channels[c] ? '' : 'is-zero'}
                  >
                    {short(r.channels[c])}
                  </span>
                ))}
              </span>
              <strong role="cell">{r.total ? money(r.total) : '—'}</strong>
            </div>
          ))}
          <div className="statement-row statement-foot" role="row">
            <span role="cell">Total</span>
            <span className="statement-cells">
              {s.channels.map((c) => (
                <span key={c} role="cell" data-label={c}>
                  {short(s.totals[c])}
                </span>
              ))}
            </span>
            <strong role="cell">{money(s.total)}</strong>
          </div>
        </div>
      )}
    </section>
  );
}

/** Printable statement, shown only by the browser print dialog (Save as PDF on iPhone). */
export function PrintStatement({ statement: s, period }: { statement: Statement; period: Period }) {
  return (
    <div className="print-sheet" aria-hidden="true">
      <header>
        <img src="/logo-burger-house.jpg" alt="" />
        <div>
          <h1>Relevé des recettes</h1>
          <p>Burger House · Saint-Rambert-d’Albon · {s.title}</p>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th>{period === 'year' ? 'Mois' : 'Jour'}</th>
            {s.channels.map((c) => (
              <th key={c}>{c}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.key}>
              <td>
                {r.label} {period === 'month' ? r.detail : ''}
              </td>
              {s.channels.map((c) => (
                <td key={c}>{short(r.channels[c])}</td>
              ))}
              <td>
                <b>{r.total ? money(r.total) : '—'}</b>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>TOTAL</td>
            {s.channels.map((c) => (
              <td key={c}>{money(s.totals[c])}</td>
            ))}
            <td>{money(s.total)}</td>
          </tr>
          <tr className="print-share">
            <td>Part</td>
            {s.channels.map((c) => (
              <td key={c}>{share(s.totals[c], s.total)} %</td>
            ))}
            <td>100 %</td>
          </tr>
        </tfoot>
      </table>
      <p className="print-note">
        Montants TTC en euros · édité le{' '}
        {new Intl.DateTimeFormat('fr-FR', {
          dateStyle: 'long',
          timeStyle: 'short',
          timeZone: 'Europe/Paris',
        }).format(new Date())}
      </p>
    </div>
  );
}
