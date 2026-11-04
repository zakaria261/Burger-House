'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Users,
  BookOpen,
  Plus,
  ChevronRight,
  ChevronLeft,
  ArrowUpRight,
  ArrowDownLeft,
  Download,
  Search,
  CalendarDays,
  Check,
  Clock3,
  Pause,
  Play,
  LogOut,
  WifiOff,
  Database,
  RefreshCw,
  X,
  Share,
  Smartphone,
  CircleHelp,
  Sparkles,
  Target,
  CircleCheck,
  ArrowRight,
  FileDown,
  ShieldCheck,
  MoreHorizontal,
  Wallet,
  CreditCard,
  Banknote,
  Trash2,
} from 'lucide-react';
import {
  Action,
  Entry,
  Period,
  Snapshot,
  Tab,
  addDays,
  csv,
  duration,
  inPeriod,
  money,
  periodShiftMs,
  shiftMs,
  today,
  totals,
} from '@/lib/model';
import { Avatar, CategoryIcon, Empty, Modal, SegmentedControl } from './ui';
import { ClockForm, EmployeeForm, EntryForm, NoteForm } from './forms';
import { AppleMark, Symbol } from './symbols';
import RevenueChart from './revenue-chart';
import { haptic, useAppearance, useNativeViewport } from '@/lib/native';
import SignIn from './sign-in';
import { authClient } from '@/lib/auth/client';
type Dialog =
  | null
  | { type: 'entry'; kind: Entry['type'] }
  | { type: 'details'; id: string }
  | { type: 'clock'; id: string; event: 'in' | 'pause' | 'resume' | 'out' }
  | { type: 'employee' }
  | { type: 'note' }
  | { type: 'install' }
  | { type: 'audit' }
  | { type: 'export' }
  | { type: 'archive'; id: string };
const NAV = [
  { id: 'overview', label: 'Résumé', short: 'Résumé', symbol: 'summary' },
  { id: 'ledger', label: 'Activité', short: 'Activité', symbol: 'activity' },
  { id: 'team', label: 'Équipe', short: 'Équipe', symbol: 'team' },
  { id: 'notebook', label: 'Notes de service', short: 'Notes', symbol: 'notes' },
] as const;
const MOBILE_NAV = [
  ...NAV,
  { id: 'settings', label: 'Réglages', short: 'Réglages', symbol: 'settings' },
] as const;
function download(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const frenchDate = (
  value: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' },
) =>
  new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'Europe/Paris' }).format(
    new Date(value + 'T12:00:00Z'),
  );
const time = (value: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
export default function Cockpit() {
  const [tab, setTab] = useState<Tab>('overview');
  const mode = 'live' as const;
  const [requiresSignIn, setRequiresSignIn] = useState(false);
  const [period, setPeriod] = useState<Period>('day');
  const [date, setDate] = useState(today());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [noteFilter, setNoteFilter] = useState('all');
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false);
  const lock = useRef(false);
  const latest = useRef<Snapshot | null>(null);
  const pendingInstall = useRef<(Event & { prompt?: () => Promise<void> }) | null>(null);
  const { appearance, setAppearance } = useAppearance();
  useNativeViewport();
  const [sheetClosing, setSheetClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => {
    setSheetClosing(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(
      () => {
        setDialog(null);
        setError('');
        setSheetClosing(false);
      },
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220,
    );
  }, []);
  const open = (d: Dialog) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setSheetClosing(false);
    setError('');
    setDialog(d);
  };
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  const refresh = useCallback(async (initial = false) => {
    try {
      const res = await fetch('/api/state', {
        cache: 'no-store',
        headers:
          !initial && latest.current
            ? { 'If-None-Match': `"live-${latest.current.revision}"` }
            : {},
      });
      if (res.status === 304) {
        setOffline(false);
        setLoadError('');
        return;
      }
      if (res.status === 401 || res.status === 403) {
        setRequiresSignIn(true);
        setSnapshot(null);
        latest.current = null;
        setOffline(false);
        setLoadError('');
        try {
          localStorage.removeItem('bh-cache-live');
        } catch {}
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(data?.error || 'Le serveur du restaurant est temporairement indisponible.');
      if (!data?.state || !Array.isArray(data.state.entries))
        throw new Error('Réponse du serveur invalide.');
      latest.current = data;
      setSnapshot(data);
      setRequiresSignIn(false);
      setOffline(false);
      setLoadError('');
      try {
        localStorage.setItem('bh-cache-live', JSON.stringify(data));
      } catch {}
    } catch (e) {
      const network = !navigator.onLine || e instanceof TypeError;
      setOffline(network);
      setLoadError(
        network
          ? 'Vous êtes hors connexion. Reconnectez cet appareil pour accéder au restaurant.'
          : e instanceof Error
            ? e.message
            : 'Connexion au restaurant indisponible.',
      );
      if (initial) {
        try {
          const cached = JSON.parse(localStorage.getItem('bh-cache-live') || 'null');
          if (cached?.state?.entries) {
            setSnapshot(cached);
            latest.current = cached;
          }
        } catch {}
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.removeItem('bh-mode');
      localStorage.removeItem('bh-cache-demo');
    } catch {}
    const params = new URLSearchParams(location.search);
    if (params.get('tab') === 'team') setTab('team');
    if (params.get('action') === 'expense') setDialog({ type: 'entry', kind: 'expense' });
    setReady(true);
    const onInstall = (event: Event) => {
      event.preventDefault();
      pendingInstall.current = event;
    };
    window.addEventListener('beforeinstallprompt', onInstall);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production')
      navigator.serviceWorker
        .register('/sw.js')
        .then(async (reg) => {
          await navigator.serviceWorker.ready;
          const urls = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .filter(
              (u) =>
                u.startsWith(location.origin + '/_next/static/') ||
                u.startsWith(location.origin + '/fonts/'),
            );
          (reg.active || reg.waiting || reg.installing)?.postMessage({ type: 'CACHE_URLS', urls });
        })
        .catch(() => {});
    return () => window.removeEventListener('beforeinstallprompt', onInstall);
  }, []);
  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    latest.current = null;
    setSnapshot(null);
    void refresh(true);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !lock.current) void refresh();
    }, 20000);
    const online = () => void refresh();
    window.addEventListener('online', online);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', online);
    };
  }, [ready, refresh]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4200);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const mutate = async (action: Action, closeAfter = true) => {
    if (lock.current || offline || loadError || !snapshot) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          revision: snapshot.revision,
          requestId: crypto.randomUUID(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if ([401, 403, 409].includes(res.status)) await refresh();
        throw new Error(data.error || 'Enregistrement impossible.');
      }
      latest.current = data;
      setSnapshot(data);
      try {
        localStorage.setItem('bh-cache-' + mode, JSON.stringify(data));
      } catch {}
      haptic('success');
      if (closeAfter) close();
      setToast(
        action.type === 'clock'
          ? 'Pointage enregistré.'
          : action.type === 'entry.void'
            ? 'Écriture annulée. La trace est conservée.'
            : 'C’est enregistré.',
      );
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Une erreur est survenue.';
      haptic('error');
      setError(message);
      if (!closeAfter) setToast(message);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const state = snapshot?.state;
  const entries = useMemo(
    () => state?.entries.filter((e) => inPeriod(e.date, date, period)) ?? [],
    [state, date, period],
  );
  const total = totals(entries);
  const balance = total.income - total.expense;
  const active = state?.shifts.filter((s) => !s.endedAt) ?? [];
  const working = active.filter((s) => !s.pauseStartedAt);
  const selectedLabel =
    period === 'day'
      ? date === today()
        ? 'Aujourd’hui'
        : frenchDate(date, { day: 'numeric', month: 'short', year: 'numeric' })
      : period === 'month'
        ? frenchDate(date, { month: 'long', year: 'numeric' })
        : date.slice(0, 4);
  const displayed = entries
    .filter(
      (e) =>
        !e.voidedAt &&
        (filter === 'all' || filter === e.type || filter === e.category) &&
        `${e.title} ${e.category} ${e.supplier} ${e.note}`
          .toLocaleLowerCase('fr')
          .includes(search.toLocaleLowerCase('fr')),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const expensesByCategory = Object.entries(
    entries
      .filter((e) => e.type === 'expense' && !e.voidedAt)
      .reduce(
        (a, e) => {
          a[e.category] = (a[e.category] || 0) + e.amount;
          return a;
        },
        {} as Record<string, number>,
      ),
  ).sort((a, b) => b[1] - a[1]);
  const laborMs = state?.shifts.reduce((a, s) => a + periodShiftMs(s, date, period, now), 0) ?? 0;
  const laborCost =
    state?.shifts.reduce(
      (a, s) =>
        a +
        (periodShiftMs(s, date, period, now) / 3600000) *
          (state.employees.find((e) => e.id === s.employeeId)?.hourlyCost ?? 0),
      0,
    ) ?? 0;
  function navigate(direction: number) {
    if (period === 'day') setDate(addDays(date, direction));
    else {
      const d = new Date(date + 'T12:00:00Z');
      if (period === 'month') {
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() + direction);
      } else d.setUTCFullYear(d.getUTCFullYear() + direction);
      setDate(d.toISOString().slice(0, 10));
    }
  }
  function selectTab(t: Tab) {
    if (t === tab) return;
    setTab(t);
    setSearch('');
    setFilter('all');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function exportEntries() {
    download(
      `burger-house-registre-${period}-${date}.csv`,
      csv([
        [
          'Date',
          'Type',
          'Libellé',
          'Catégorie',
          'Montant TTC EUR',
          'Paiement',
          'Fournisseur ou référence',
          'Note',
          'Statut',
        ],
        ...entries.map((e) => [
          e.date,
          e.type === 'income' ? 'Recette' : 'Dépense',
          e.title,
          e.category,
          (e.amount / 100).toFixed(2),
          e.payment,
          e.supplier,
          e.note,
          e.voidedAt ? 'Annulée' : 'Active',
        ]),
      ]),
    );
    setToast('Le registre a été exporté.');
    close();
  }
  function exportShifts() {
    if (!state) return;
    download(
      `burger-house-pointages-${period}-${date}.csv`,
      csv([
        [
          'Salarié',
          'Poste',
          'Début Europe/Paris',
          'Fin Europe/Paris',
          'Pause minutes',
          'Heures travaillées',
          'Coût horaire estimé EUR',
          'Coût estimé EUR',
        ],
        ...state.shifts
          .filter((s) => inPeriod(today(new Date(s.startedAt)), date, period))
          .map((s) => {
            const e = state.employees.find((e) => e.id === s.employeeId);
            const hours = shiftMs(s, now) / 3600000;
            return [
              e?.name ?? '',
              e?.role ?? '',
              new Date(s.startedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }),
              s.endedAt
                ? new Date(s.endedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })
                : 'En cours',
              Math.round(
                (s.pauseMs + (s.pauseStartedAt ? now - Date.parse(s.pauseStartedAt) : 0)) / 60000,
              ),
              hours.toFixed(2),
              ((e?.hourlyCost ?? 0) / 100).toFixed(2),
              ((hours * (e?.hourlyCost ?? 0)) / 100).toFixed(2),
            ];
          }),
      ]),
    );
    setToast('Les pointages ont été exportés.');
    close();
  }
  if (requiresSignIn)
    return (
      <SignIn
        onAuthenticated={() => {
          setRequiresSignIn(false);
          setLoading(true);
          void refresh(true);
        }}
      />
    );
  const unavailable = offline || !!loadError;
  const props = {
    submit: (action: Action) => {
      if (unavailable) {
        setError(loadError || 'Vous êtes hors connexion.');
        return Promise.resolve(false);
      }
      return mutate(action);
    },
    busy,
    error,
  };
  return (
    <div
      className="app-shell"
      data-tab={tab}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('button:not(:disabled)')) haptic();
      }}
    >
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>
      <aside className="sidebar">
        <a href="/" className="brand">
          <img src="/logo-burger-house.jpg" alt="Burger House" />
          <span>
            Burger House<small>Saint-Rambert-d’Albon</small>
          </span>
        </a>
        <div className="nav-label">Restaurant</div>
        <nav className="desktop-nav" aria-label="Navigation principale">
          {NAV.map((n) => (
            <button
              key={n.id}
              aria-current={tab === n.id ? 'page' : undefined}
              className={tab === n.id ? 'selected' : ''}
              onClick={() => selectTab(n.id)}
            >
              <span className={`sidebar-symbol sidebar-${n.id}`}>
                <Symbol name={n.symbol} size={19} filled />
              </span>
              {n.label}
              {n.id === 'notebook' && !!state?.notes.filter((n) => !n.done).length && (
                <span className="nav-count">{state.notes.filter((n) => !n.done).length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`settings-nav ${tab === 'settings' ? 'selected' : ''}`}
            onClick={() => selectTab('settings')}
          >
            <span className="sidebar-symbol sidebar-settings">
              <Symbol name="settings" size={19} filled />
            </span>
            Réglages
            <ChevronRight size={15} />
          </button>
          <button className="installation-card" onClick={() => open({ type: 'install' })}>
            <AppleMark size={25} />
            <span>
              Sur votre iPhone<small>Ajouter à l’écran d’accueil</small>
            </span>
            <ChevronRight size={15} />
          </button>
          <span className="sidebar-signature">Burger House · Gestion privée</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-context">
            <span className="mobile-logo">
              <img src="/logo-burger-house.jpg" alt="" />
              <span>
                Burger House<small>Saint-Rambert-d’Albon</small>
              </span>
            </span>
            <span className="desktop-context">
              Mon restaurant
              <ChevronRight size={13} />
              <strong>{NAV.find((n) => n.id === tab)?.label ?? 'Réglages'}</strong>
            </span>
          </div>
          <span className="compact-title" aria-hidden="true">
            {NAV.find((n) => n.id === tab)?.short ?? 'Réglages'}
          </span>
          <div className="topbar-actions">
            <span className="sync-label">
              <span className={`status-dot ${offline ? 'offline-dot' : ''}`} />
              {offline ? 'Hors connexion' : loadError ? 'Serveur indisponible' : 'À jour'}
            </span>
            <button
              className="icon-button notification-button"
              aria-label="Historique d’activité"
              onClick={() => open({ type: 'audit' })}
            >
              <Symbol name="bell" size={22} />
              {!!state?.audit.length && <i />}
            </button>
            <button
              className="profile"
              aria-label="Réglages du restaurant"
              onClick={() => selectTab('settings')}
            >
              <img src="/logo-burger-house.jpg" alt="" />
            </button>
          </div>
        </header>
        <main id="main-content">
          {(offline || (loadError && snapshot)) && (
            <div className="offline-banner">
              {offline ? <WifiOff size={16} /> : <Database size={16} />}
              <span>
                {offline
                  ? 'Hors connexion · consultation de la dernière sauvegarde. Les saisies reprendront au retour du réseau.'
                  : loadError}
              </span>
              <button className="text-button" onClick={() => void refresh(true)}>
                <RefreshCw size={15} />
                Réessayer
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {frenchDate(today(), { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              <h1>
                {tab === 'overview'
                  ? 'Résumé'
                  : tab === 'ledger'
                    ? 'Activité'
                    : tab === 'team'
                      ? 'Équipe'
                      : tab === 'notebook'
                        ? 'Notes'
                        : 'Réglages'}
              </h1>
              <p>
                {tab === 'overview'
                  ? 'Les chiffres de votre restaurant.'
                  : tab === 'ledger'
                    ? 'Recettes, dépenses et justificatifs.'
                    : tab === 'team'
                      ? 'Pointages et temps de travail.'
                      : tab === 'notebook'
                        ? 'Les informations du prochain service.'
                        : 'Votre restaurant, vos préférences.'}
              </p>
            </div>
            <div className="heading-buttons">
              {(tab === 'overview' || tab === 'ledger') && (
                <>
                  <button
                    className="button button-secondary export-btn"
                    onClick={() => open({ type: 'export' })}
                    disabled={!state}
                  >
                    <Download size={16} />
                    Exporter
                  </button>
                  <button
                    className="button button-primary"
                    aria-label="Ajouter une écriture"
                    onClick={() => open({ type: 'entry', kind: 'expense' })}
                    disabled={unavailable || !state}
                  >
                    <Plus size={18} />
                    <span>Nouvelle écriture</span>
                  </button>
                </>
              )}
              {tab === 'team' && (
                <button
                  className="button button-primary"
                  aria-label="Ajouter un salarié"
                  disabled={!state || unavailable}
                  onClick={() => open({ type: 'employee' })}
                >
                  <Plus size={18} />
                  Ajouter un salarié
                </button>
              )}
              {tab === 'notebook' && (
                <button
                  className="button button-primary"
                  aria-label="Ajouter une note"
                  disabled={!state || unavailable}
                  onClick={() => open({ type: 'note' })}
                >
                  <Plus size={18} />
                  Nouvelle note
                </button>
              )}
            </div>
          </div>
          {(['overview', 'ledger', 'team'] as Tab[]).includes(tab) && (
            <div className="period-toolbar">
              <SegmentedControl
                options={
                  [
                    { value: 'day', label: 'Jour' },
                    { value: 'month', label: 'Mois' },
                    { value: 'year', label: 'Année' },
                  ] as const
                }
                value={period}
                onChange={setPeriod}
                label="Période"
              />
              <div className="date-controls">
                <button
                  className="icon-button"
                  aria-label="Période précédente"
                  onClick={() => navigate(-1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <label className="date-label">
                  <CalendarDays size={16} />
                  <span>{selectedLabel}</span>
                  <input
                    aria-label="Choisir une date"
                    type="date"
                    value={date}
                    max={today()}
                    onChange={(e) => {
                      if (e.target.value) setDate(e.target.value);
                    }}
                  />
                </label>
                <button
                  className="icon-button"
                  aria-label="Période suivante"
                  disabled={inPeriod(today(), date, period) || date > today()}
                  onClick={() => navigate(1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          )}
          <div className="page-content" key={tab}>
            {loading ? (
              <div className="loading-state" aria-label="Chargement">
                <div className="skeleton skeleton-hero" />
                <div className="skeleton-row">
                  <div className="skeleton" />
                  <div className="skeleton" />
                  <div className="skeleton" />
                </div>
                <div className="skeleton skeleton-table" />
              </div>
            ) : loadError && !state ? (
              <div className="connection-error">
                {offline ? <WifiOff size={32} /> : <Database size={32} />}
                <h2>{offline ? 'Vous êtes hors connexion' : 'Connexion au restaurant'}</h2>
                <p>{loadError}</p>
                <button
                  className="button button-primary"
                  onClick={() => {
                    setLoading(true);
                    void refresh(true);
                  }}
                >
                  Réessayer
                  <RefreshCw size={16} />
                </button>
              </div>
            ) : (
              state && (
                <>
                  {tab === 'overview' && (
                    <>
                      <div className="overview-grid">
                        <div className="overview-primary">
                          <section className="revenue-hero">
                            <div className="hero-copy">
                              <div className="hero-kicker">
                                <span className="mini-icon">
                                  <ArrowDownLeft size={18} />
                                </span>
                                Recettes encaissées
                                <span className="period-tag">
                                  {period === 'day'
                                    ? 'Jour'
                                    : period === 'month'
                                      ? 'Mois'
                                      : 'Année'}
                                </span>
                              </div>
                              <div className="hero-amount">
                                {money(total.income).split(',')[0]}
                                <span>,{money(total.income).split(',')[1]}</span>
                              </div>
                              <p>Montant total TTC</p>
                              <button
                                onClick={() => open({ type: 'entry', kind: 'income' })}
                                disabled={unavailable}
                              >
                                <Plus size={16} />
                                Ajouter une recette
                                <ArrowUpRight size={16} />
                              </button>
                            </div>
                            <RevenueChart entries={state.entries} date={date} period={period} />
                            <div className="hero-footer">
                              <span>
                                <span className="status-dot" />
                                {offline ? 'Dernière sauvegarde' : 'Recettes enregistrées'}
                              </span>
                              <span>
                                {selectedLabel}
                                <ArrowUpRight size={13} />
                              </span>
                            </div>
                          </section>
                          <div className="metrics-grid">
                            <Metric
                              label="Dépenses"
                              value={money(total.expense)}
                              icon={<ArrowUpRight size={17} />}
                              caption="Dépenses enregistrées"
                              className="expense"
                            />
                            <Metric
                              label="Solde"
                              value={money(balance)}
                              icon={<Wallet size={17} />}
                              caption="Recettes − dépenses saisies"
                              className={balance >= 0 ? 'balance' : 'negative'}
                            />
                            <Metric
                              label="Temps travaillé"
                              value={duration(laborMs)}
                              icon={<Clock3 size={17} />}
                              caption={`${money(Math.round(laborCost), false)} de coût estimé*`}
                              className="hours"
                            />
                          </div>
                          <section className="panel recent-panel">
                            <PanelHeader
                              title="Derniers mouvements"
                              subtitle="Recettes et dépenses récentes."
                              action={
                                <button className="text-button" onClick={() => selectTab('ledger')}>
                                  Tout voir
                                  <ArrowUpRight size={15} />
                                </button>
                              }
                            />
                            {displayed.length ? (
                              <div className="transactions-list">
                                {displayed.slice(0, 5).map((e) => (
                                  <TransactionRow
                                    key={e.id}
                                    entry={e}
                                    onClick={() => open({ type: 'details', id: e.id })}
                                  />
                                ))}
                              </div>
                            ) : (
                              <Empty
                                title="Le début d’une belle journée"
                                body="Ajoutez votre première recette ou dépense pour voir votre activité ici."
                                action={
                                  <button
                                    className="text-button"
                                    onClick={() => open({ type: 'entry', kind: 'income' })}
                                  >
                                    Ajouter une recette
                                    <Plus size={15} />
                                  </button>
                                }
                              />
                            )}
                            <div className="panel-footnote">
                              <ShieldCheck size={13} /> Chaque écriture est horodatée et conservée.
                            </div>
                          </section>
                        </div>
                        <div className="overview-rail">
                          <section className="panel team-preview">
                            <PanelHeader
                              title="En service"
                              action={
                                <span className="live-pill">
                                  <span className="status-dot" />
                                  En direct
                                </span>
                              }
                            />
                            <div className="team-count">
                              <strong>{working.length}</strong>
                              <span>
                                en service
                                <small>
                                  {active.length - working.length} en pause ·{' '}
                                  {state.employees.filter((e) => e.active).length} dans l’équipe
                                </small>
                              </span>
                              <span className="team-count-icon">
                                <Users size={24} />
                              </span>
                            </div>
                            <div className="mini-team-list">
                              {state.employees
                                .filter((e) => e.active)
                                .slice(0, 4)
                                .map((e) => {
                                  const shift = active.find((s) => s.employeeId === e.id);
                                  return (
                                    <button key={e.id} onClick={() => selectTab('team')}>
                                      <Avatar name={e.name} color={e.color} small />
                                      <span>
                                        {e.name.split(' ')[0]}
                                        <small>{e.role}</small>
                                      </span>
                                      <span
                                        className={`person-status ${!shift ? 'status-away' : shift.pauseStartedAt ? 'status-pause' : 'status-active'}`}
                                      >
                                        {!shift
                                          ? 'Absent'
                                          : shift.pauseStartedAt
                                            ? 'En pause'
                                            : 'En service'}
                                      </span>
                                    </button>
                                  );
                                })}
                            </div>
                            <button className="rail-link" onClick={() => selectTab('team')}>
                              Gérer les pointages
                              <ArrowRight size={15} />
                            </button>
                          </section>
                          <section className="goal-card">
                            <div className="goal-card-header">
                              <span>
                                <Target size={18} />
                                Objectif quotidien
                              </span>
                              <button
                                aria-label="Modifier l’objectif quotidien"
                                onClick={() => selectTab('settings')}
                              >
                                <MoreHorizontal size={20} />
                              </button>
                            </div>
                            {state.goal > 0 ? (
                              <>
                                <div className="goal-content">
                                  <div>
                                    <strong>
                                      {Math.round(
                                        Math.min(
                                          999,
                                          (totals(state.entries.filter((e) => e.date === today()))
                                            .income /
                                            state.goal) *
                                            100,
                                        ),
                                      )}
                                      <span>%</span>
                                    </strong>
                                    <p>de l’objectif de recettes</p>
                                  </div>
                                  <GoalRing
                                    value={
                                      totals(state.entries.filter((e) => e.date === today()))
                                        .income / state.goal
                                    }
                                  />
                                </div>
                                <div className="goal-card-footer">
                                  <span>
                                    {money(
                                      totals(state.entries.filter((e) => e.date === today()))
                                        .income,
                                      false,
                                    )}{' '}
                                    encaissés
                                  </span>
                                  <span>sur {money(state.goal, false)}</span>
                                </div>
                              </>
                            ) : (
                              <div className="goal-empty">
                                <p>Aucun objectif défini pour le moment.</p>
                                <button onClick={() => selectTab('settings')}>
                                  Définir mon objectif
                                  <ChevronRight size={16} />
                                </button>
                              </div>
                            )}
                          </section>
                          <section className="notebook-preview">
                            <span className="notebook-label">
                              <Symbol name="notes" size={20} filled />
                              Note de service
                            </span>
                            <h3>
                              {state.notes.find((n) => !n.done)?.title ?? 'Aucune note en attente'}
                            </h3>
                            <p>
                              {state.notes.find((n) => !n.done)?.body ??
                                'Les informations du prochain service ont leur place ici. Ajoutez votre première note.'}
                            </p>
                            <button className="text-button" onClick={() => selectTab('notebook')}>
                              Ouvrir le cahier
                              <ArrowUpRight size={16} />
                            </button>
                          </section>
                        </div>
                      </div>
                      <section className="panel breakdown-panel">
                        <PanelHeader
                          title="Répartition des dépenses"
                          subtitle="Par catégorie sur la période."
                          action={<span className="soft-label">{selectedLabel}</span>}
                        />
                        {expensesByCategory.length ? (
                          <div className="breakdown-grid">
                            {expensesByCategory.slice(0, 4).map(([category, amount], i) => (
                              <button
                                key={category}
                                className="category-breakdown"
                                onClick={() => {
                                  selectTab('ledger');
                                  setFilter(category);
                                }}
                              >
                                <span className={`category-symbol color-${i}`}>
                                  <CategoryIcon category={category} />
                                </span>
                                <div>
                                  <span>
                                    {category}
                                    <small>
                                      {Math.round((amount / total.expense) * 100)} % des dépenses
                                    </small>
                                  </span>
                                  <strong>{money(amount)}</strong>
                                  <div className="mini-progress">
                                    <i style={{ width: `${(amount / total.expense) * 100}%` }} />
                                  </div>
                                </div>
                                <ChevronRight size={15} />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="inline-empty">
                            Vos catégories apparaîtront dès la première dépense.
                          </div>
                        )}
                      </section>
                      <p className="footnote">
                        * Coût salarial indicatif, calculé sur les heures pointées et les taux
                        renseignés. Il n’est pas déduit une seconde fois du solde.
                      </p>
                    </>
                  )}
                  {tab === 'ledger' && (
                    <>
                      <div className="ledger-summary">
                        <div>
                          <span>Recettes</span>
                          <strong className="text-green">{money(total.income)}</strong>
                        </div>
                        <div>
                          <span>Dépenses</span>
                          <strong>{money(total.expense)}</strong>
                        </div>
                        <div>
                          <span>Solde d’exploitation</span>
                          <strong>{money(balance)}</strong>
                        </div>
                        <button
                          className="button button-soft"
                          onClick={() => open({ type: 'entry', kind: 'income' })}
                          disabled={unavailable}
                        >
                          <ArrowDownLeft size={18} />
                          Ajouter une recette
                        </button>
                      </div>
                      <section className="panel ledger-panel">
                        <div className="ledger-tools">
                          <div className="filter-tabs">
                            {[
                              ['all', 'Tous'],
                              ['income', 'Recettes'],
                              ['expense', 'Dépenses'],
                            ].map(([v, l]) => (
                              <button
                                className={filter === v ? 'active' : ''}
                                key={v}
                                onClick={() => setFilter(v)}
                              >
                                {l}
                              </button>
                            ))}
                          </div>
                          <div className="ledger-search">
                            <Search size={17} />
                            <input
                              aria-label="Rechercher une écriture"
                              placeholder="Rechercher un mouvement…"
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                            />
                          </div>
                          <select
                            className="category-filter"
                            aria-label="Filtrer par catégorie"
                            value={['all', 'income', 'expense'].includes(filter) ? 'all' : filter}
                            onChange={(e) => setFilter(e.target.value)}
                          >
                            <option value="all">Toutes les catégories</option>
                            {[
                              'Ingrédients',
                              'Salaires',
                              'Emballages',
                              'Loyer & charges',
                              'Énergie',
                              'Équipement',
                              'Autres',
                              'Sur place',
                              'À emporter',
                              'Livraison',
                            ].map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                        <div className="table-labels">
                          <span>LIBELLÉ / CATÉGORIE</span>
                          <span>PAIEMENT</span>
                          <span>MONTANT TTC</span>
                        </div>
                        {displayed.length ? (
                          <div>
                            {displayed.map((e) => (
                              <TransactionRow
                                key={e.id}
                                entry={e}
                                detailed
                                onClick={() => open({ type: 'details', id: e.id })}
                              />
                            ))}
                          </div>
                        ) : (
                          <Empty
                            title={search ? 'Aucun résultat' : 'Votre registre est prêt'}
                            body={
                              search
                                ? 'Essayez un autre libellé ou une autre catégorie.'
                                : 'Enregistrez une recette ou une dépense pour commencer.'
                            }
                          />
                        )}
                        <div className="ledger-footer">
                          <span>
                            {displayed.length} mouvement{displayed.length > 1 ? 's' : ''}
                          </span>
                          <span>Montants TTC · EUR</span>
                        </div>
                      </section>
                      <p className="footnote">
                        Le solde correspond aux recettes moins les dépenses saisies. Ce registre de
                        gestion ne remplace pas votre comptabilité.
                      </p>
                    </>
                  )}
                  {tab === 'team' && (
                    <>
                      <div className="team-summary">
                        <div>
                          <span className="live-pill">
                            <span className="status-dot" />
                            EN CE MOMENT
                          </span>
                          <strong>
                            {working.length}
                            <small>en service</small>
                          </strong>
                        </div>
                        <div>
                          <span>Heures sur la période</span>
                          <strong>{duration(laborMs)}</strong>
                        </div>
                        <div>
                          <span>Coût salarial estimé</span>
                          <strong>{money(Math.round(laborCost))}</strong>
                        </div>
                        <button className="button button-secondary" onClick={exportShifts}>
                          <FileDown size={17} />
                          Exporter les heures
                        </button>
                      </div>

                      <div className="employee-grid">
                        {state.employees
                          .filter((e) => e.active)
                          .map((e) => {
                            const shift = active.find((s) => s.employeeId === e.id);
                            const worked = state.shifts
                              .filter((s) => s.employeeId === e.id)
                              .reduce((a, s) => a + periodShiftMs(s, date, period, now), 0);
                            return (
                              <section className="panel employee-card" key={e.id}>
                                <div className="employee-top">
                                  <Avatar name={e.name} color={e.color} />
                                  <span
                                    className={`person-status ${!shift ? 'status-away' : shift.pauseStartedAt ? 'status-pause' : 'status-active'}`}
                                  >
                                    <span className="status-dot" />
                                    {!shift
                                      ? 'Hors service'
                                      : shift.pauseStartedAt
                                        ? 'En pause'
                                        : 'En service'}
                                  </span>
                                  <button
                                    className="icon-button"
                                    aria-label={`Archiver ${e.name}`}
                                    disabled={unavailable || !!shift}
                                    onClick={() => open({ type: 'archive', id: e.id })}
                                  >
                                    <MoreHorizontal size={19} />
                                  </button>
                                </div>
                                <h3>{e.name}</h3>
                                <p>{e.role}</p>
                                <div className="employee-time">
                                  <span>
                                    {shift ? 'Service en cours' : 'Heures sur la période'}
                                  </span>
                                  <strong>
                                    {shift ? duration(shiftMs(shift, now)) : duration(worked)}
                                    <Clock3 size={17} />
                                  </strong>
                                  <small>
                                    {shift
                                      ? `Début à ${time(shift.startedAt)}${shift.pauseStartedAt ? ` · Pause depuis ${time(shift.pauseStartedAt)}` : ''}`
                                      : `${money(e.hourlyCost)} / h · coût estimé`}
                                  </small>
                                </div>
                                <div className="employee-actions">
                                  {!shift ? (
                                    <button
                                      className="button button-primary full"
                                      disabled={unavailable}
                                      onClick={() => open({ type: 'clock', id: e.id, event: 'in' })}
                                    >
                                      <Play size={16} />
                                      Commencer le service
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        className="button button-secondary"
                                        disabled={unavailable}
                                        onClick={() =>
                                          open({
                                            type: 'clock',
                                            id: e.id,
                                            event: shift.pauseStartedAt ? 'resume' : 'pause',
                                          })
                                        }
                                      >
                                        {shift.pauseStartedAt ? (
                                          <Play size={16} />
                                        ) : (
                                          <Pause size={16} />
                                        )}{' '}
                                        {shift.pauseStartedAt ? 'Reprendre' : 'Pause'}
                                      </button>
                                      <button
                                        className="button button-dark"
                                        disabled={unavailable}
                                        onClick={() =>
                                          open({ type: 'clock', id: e.id, event: 'out' })
                                        }
                                      >
                                        <LogOut size={16} />
                                        Terminer
                                      </button>
                                    </>
                                  )}
                                </div>
                              </section>
                            );
                          })}
                        {!state.employees.some((e) => e.active) && (
                          <div className="panel full">
                            <Empty
                              title="La maison attend son équipe"
                              body="Ajoutez vos salariés avec un code personnel pour commencer le pointage."
                              action={
                                <button
                                  className="button button-primary"
                                  onClick={() => open({ type: 'employee' })}
                                >
                                  Ajouter un salarié
                                  <Plus size={16} />
                                </button>
                              }
                            />
                          </div>
                        )}
                      </div>
                      <section className="panel shift-history">
                        <PanelHeader
                          title="Historique des pointages"
                          subtitle="Les pointages de la période sélectionnée."
                          action={<span className="soft-label">Europe / Paris</span>}
                        />
                        {state.shifts.filter((s) =>
                          inPeriod(today(new Date(s.startedAt)), date, period),
                        ).length ? (
                          <div className="shift-table">
                            <div className="shift-row shift-table-head">
                              <span>SALARIÉ</span>
                              <span>DATE</span>
                              <span>ARRIVÉE / DÉPART</span>
                              <span>PAUSES</span>
                              <span>TEMPS NET</span>
                            </div>
                            {state.shifts
                              .filter((s) => inPeriod(today(new Date(s.startedAt)), date, period))
                              .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                              .map((s) => {
                                const e = state.employees.find((e) => e.id === s.employeeId);
                                return (
                                  <div className="shift-row" key={s.id}>
                                    <span>
                                      <Avatar name={e?.name ?? '?'} color={e?.color} small />
                                      {e?.name}
                                    </span>
                                    <span>
                                      {frenchDate(today(new Date(s.startedAt)), {
                                        day: 'numeric',
                                        month: 'short',
                                      })}
                                    </span>
                                    <span>
                                      {time(s.startedAt)} <span className="muted">→</span>{' '}
                                      {s.endedAt ? time(s.endedAt) : 'En cours'}
                                    </span>
                                    <span>
                                      {Math.floor(
                                        (s.pauseMs +
                                          (s.pauseStartedAt
                                            ? now - Date.parse(s.pauseStartedAt)
                                            : 0)) /
                                          60000,
                                      )}{' '}
                                      min
                                    </span>
                                    <strong>{duration(shiftMs(s, now))}</strong>
                                  </div>
                                );
                              })}
                          </div>
                        ) : (
                          <div className="inline-empty">Aucun pointage sur cette période.</div>
                        )}
                      </section>
                      <p className="footnote">
                        Les pauses sont déduites du temps net. Un service est rattaché à sa date de
                        début en heure de Paris. Les taux horaires sont des estimations, à
                        renseigner par le responsable.
                      </p>
                    </>
                  )}
                  {tab === 'notebook' && (
                    <>
                      <div className="notebook-toolbar">
                        <div className="filter-tabs">
                          {[
                            ['all', 'Toutes les notes'],
                            ['Service', 'Service'],
                            ['À commander', 'À commander'],
                            ['Équipe', 'Équipe'],
                          ].map(([v, l]) => (
                            <button
                              key={v}
                              className={noteFilter === v ? 'active' : ''}
                              onClick={() => setNoteFilter(v)}
                            >
                              {l}
                            </button>
                          ))}
                        </div>
                        <span className="muted">
                          {state.notes.filter((n) => !n.done).length} en attente
                        </span>
                      </div>
                      <div className="notes-grid">
                        {state.notes
                          .filter((n) => noteFilter === 'all' || n.category === noteFilter)
                          .map((n) => (
                            <article
                              className={`note-card note-${n.category === 'Service' ? 'service' : n.category === 'Équipe' ? 'team' : 'order'} ${n.done ? 'note-done' : ''}`}
                              key={n.id}
                            >
                              <div className="note-top">
                                <span>{n.category}</span>
                                <button
                                  className={`note-check ${n.done ? 'checked' : ''}`}
                                  aria-pressed={n.done}
                                  aria-label={`${n.done ? 'Réouvrir' : 'Terminer'} : ${n.title}`}
                                  disabled={busy || unavailable}
                                  onClick={() =>
                                    void mutate({ type: 'note.toggle', id: n.id }, false)
                                  }
                                >
                                  {n.done ? <Check size={17} /> : <span />}
                                </button>
                              </div>
                              <h3>{n.title}</h3>
                              <p>{n.body}</p>
                              <div className="note-bottom">
                                <span>
                                  {frenchDate(today(new Date(n.createdAt)), {
                                    day: 'numeric',
                                    month: 'short',
                                  })}
                                </span>
                                <BookOpen size={17} />
                              </div>
                            </article>
                          ))}
                        {!state.notes.length && (
                          <div className="panel full">
                            <Empty
                              title="Le prochain service commence ici"
                              body="Une commande à passer, une consigne ou une idée ? Gardez-en une trace pour l’équipe."
                              action={
                                <button
                                  className="button button-primary"
                                  onClick={() => open({ type: 'note' })}
                                >
                                  <Plus size={17} />
                                  Écrire une note
                                </button>
                              }
                            />
                          </div>
                        )}
                        <button
                          className="add-note-card"
                          disabled={unavailable}
                          onClick={() => open({ type: 'note' })}
                        >
                          <span>
                            <Plus size={25} />
                          </span>
                          <strong>Nouvelle note</strong>
                          <p>Ajouter une information de service.</p>
                        </button>
                      </div>
                    </>
                  )}
                  {tab === 'settings' && (
                    <div className="settings-grid">
                      <section className="panel settings-panel">
                        <PanelHeader title="Restaurant" subtitle="Votre espace de gestion." />
                        <div className="restaurant-profile">
                          <img src="/logo-burger-house.jpg" alt="Logo officiel Burger House" />
                          <div>
                            <h3>Burger House</h3>
                            <p>Saint-Rambert-d’Albon</p>
                            <span className="soft-label">Le cockpit · version 3.0</span>
                          </div>
                        </div>
                        {snapshot.user && (
                          <div className="setting-row">
                            <span>
                              Compte responsable<small>{snapshot.user.email}</small>
                            </span>
                            <button
                              className="button button-secondary"
                              disabled={busy || offline}
                              onClick={async () => {
                                try {
                                  const result = await authClient.signOut();
                                  if (result.error) throw new Error();
                                  localStorage.removeItem('bh-cache-live');
                                  setSnapshot(null);
                                  latest.current = null;
                                  setRequiresSignIn(true);
                                } catch {
                                  setToast(
                                    'Déconnexion impossible. Réessayez avec une connexion réseau.',
                                  );
                                }
                              }}
                            >
                              <LogOut size={16} />
                              Déconnexion
                            </button>
                          </div>
                        )}
                        <div className="setting-row">
                          <span>
                            Sur votre iPhone
                            <small>Accédez à l’app depuis votre écran d’accueil.</small>
                          </span>
                          <button
                            className="button button-secondary"
                            onClick={() => open({ type: 'install' })}
                          >
                            <AppleMark size={16} />
                            Installer
                          </button>
                        </div>
                      </section>
                      <section className="panel settings-panel appearance-panel">
                        <PanelHeader
                          title="Apparence"
                          subtitle="Choisissez l’affichage qui vous convient."
                        />
                        <div className="appearance-picker" role="group" aria-label="Apparence">
                          {(
                            [
                              { value: 'light', label: 'Clair', icon: 'sun' },
                              { value: 'dark', label: 'Sombre', icon: 'moon' },
                              { value: 'system', label: 'Automatique', icon: 'display' },
                            ] as const
                          ).map((a) => (
                            <button
                              key={a.value}
                              className={appearance === a.value ? 'selected' : ''}
                              aria-pressed={appearance === a.value}
                              onClick={() => setAppearance(a.value)}
                            >
                              <span className={`appearance-preview preview-${a.value}`}>
                                <span />
                                <i />
                                <i />
                                <i />
                              </span>
                              <span>
                                <Symbol name={a.icon} size={16} />
                                {a.label}
                              </span>
                              <span className="appearance-radio">
                                {appearance === a.value && <Symbol name="checkmark" size={12} />}
                              </span>
                            </button>
                          ))}
                        </div>
                        <p className="field-help appearance-help">
                          Automatique suit l’apparence de votre appareil.
                        </p>
                      </section>
                      <section className="panel settings-panel">
                        <PanelHeader
                          title="Objectif de recettes"
                          subtitle="Votre objectif de recettes quotidien."
                        />
                        <form
                          className="goal-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void mutate(
                              { type: 'goal', amount: Math.round(Number(f.get('goal')) * 100) },
                              false,
                            );
                          }}
                        >
                          <label>
                            Objectif quotidien TTC (€)
                            <input
                              key={state.goal + mode}
                              type="number"
                              name="goal"
                              defaultValue={state.goal ? state.goal / 100 : ''}
                              placeholder="Montant de votre objectif"
                              min="1"
                              step="0.01"
                              max="1000000"
                              required
                            />
                          </label>
                          <button className="button button-primary" disabled={busy || unavailable}>
                            Enregistrer
                            <Check size={16} />
                          </button>
                        </form>
                      </section>
                      <section className="panel settings-panel">
                        <PanelHeader
                          title="Données et exports"
                          subtitle="Vos fichiers de gestion."
                        />
                        <div className="setting-row">
                          <span>
                            Exporter le registre
                            <small>Fichier CSV de la période sélectionnée.</small>
                          </span>
                          <button
                            className="icon-button"
                            aria-label="Exporter le registre"
                            onClick={exportEntries}
                          >
                            <Download size={20} />
                          </button>
                        </div>
                        <div className="setting-row">
                          <span>
                            Exporter les heures<small>Pointages, pauses et heures nettes.</small>
                          </span>
                          <button
                            className="icon-button"
                            aria-label="Exporter les heures"
                            onClick={exportShifts}
                          >
                            <Download size={20} />
                          </button>
                        </div>
                        <div className="setting-row">
                          <span>
                            Historique des actions
                            <small>Consulter les dernières modifications.</small>
                          </span>
                          <button
                            className="icon-button"
                            aria-label="Consulter l’historique"
                            onClick={() => open({ type: 'audit' })}
                          >
                            <ChevronRight size={20} />
                          </button>
                        </div>
                        <div className="setting-row">
                          <span>
                            Sauvegarde complète
                            <small>Export JSON du registre, des notes et des pointages.</small>
                          </span>
                          <button
                            className="icon-button"
                            aria-label="Télécharger une sauvegarde complète"
                            onClick={() => {
                              download(
                                `burger-house-sauvegarde-${mode}-${today()}.json`,
                                JSON.stringify(
                                  { exportedAt: new Date().toISOString(), mode, ...snapshot },
                                  null,
                                  2,
                                ),
                                'application/json',
                              );
                              setToast('Sauvegarde téléchargée.');
                            }}
                          >
                            <Download size={20} />
                          </button>
                        </div>
                      </section>
                      <div className="settings-message">
                        <ShieldCheck size={29} />
                        <h3>Enregistré. Et conservé.</h3>
                        <p>
                          Vos écritures sont sauvegardées sur le serveur. Les annulations restent
                          dans l’historique. Les codes de pointage ne sont jamais inclus dans les
                          exports.
                        </p>
                        <small>
                          Application de gestion interne. Aucun calcul de paie ou certification
                          comptable.
                        </small>
                      </div>
                    </div>
                  )}
                </>
              )
            )}
          </div>
          <footer className="app-footer">
            <span>Burger House · Saint-Rambert-d’Albon</span>
            <span>Le cockpit 3.0</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Navigation mobile">
        {MOBILE_NAV.map((n) => (
          <button
            key={n.id}
            aria-current={tab === n.id ? 'page' : undefined}
            className={tab === n.id ? 'active' : ''}
            onClick={() => selectTab(n.id)}
          >
            <span className="tab-icon">
              <Symbol name={n.symbol} size={23} filled={tab === n.id} />
            </span>
            <span>{n.short}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={19} />
          <span>{toast}</span>
          <button aria-label="Fermer la notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {dialog?.type === 'entry' && (
        <Modal
          title={dialog.kind === 'income' ? 'Ajouter une recette' : 'Ajouter une dépense'}
          subtitle="Montant, catégorie et détail du mouvement."
          onClose={close}
          closing={sheetClosing}
        >
          <SegmentedControl
            className="entry-type-switch"
            options={
              [
                { value: 'income', label: 'Recette', icon: <ArrowDownLeft size={17} /> },
                { value: 'expense', label: 'Dépense', icon: <ArrowUpRight size={17} /> },
              ] as const
            }
            value={dialog.kind}
            onChange={(kind) => open({ type: 'entry', kind })}
            label="Type de mouvement"
          />
          <EntryForm key={dialog.kind} type={dialog.kind} {...props} />
        </Modal>
      )}
      {dialog?.type === 'employee' && (
        <Modal
          title="Ajouter un salarié"
          subtitle="Identité et code de pointage personnel."
          onClose={close}
          closing={sheetClosing}
        >
          <EmployeeForm {...props} />
        </Modal>
      )}
      {dialog?.type === 'clock' &&
        state &&
        (() => {
          const e = state.employees.find((e) => e.id === dialog.id);
          return e ? (
            <Modal
              title="Votre pointage"
              subtitle="Confirmez avec votre code personnel."
              onClose={close}
              closing={sheetClosing}
            >
              <ClockForm
                employee={e}
                shift={active.find((s) => s.employeeId === e.id)}
                event={dialog.event}
                {...props}
              />
            </Modal>
          ) : null;
        })()}
      {dialog?.type === 'note' && (
        <Modal
          title="Nouvelle note"
          subtitle="Une information pour l’équipe."
          onClose={close}
          closing={sheetClosing}
        >
          <NoteForm {...props} />
        </Modal>
      )}
      {dialog?.type === 'details' &&
        state &&
        (() => {
          const e = state.entries.find((e) => e.id === dialog.id);
          return e ? (
            <Modal title="Le détail du mouvement" onClose={close} closing={sheetClosing}>
              <EntryDetails
                entry={e}
                busy={busy}
                error={error}
                offline={unavailable}
                onVoid={() => void mutate({ type: 'entry.void', id: e.id })}
              />
            </Modal>
          ) : null;
        })()}
      {dialog?.type === 'install' && (
        <Modal
          title="Installer Burger House"
          subtitle="Sur votre iPhone ou votre iPad."
          onClose={close}
          closing={sheetClosing}
        >
          <div className="install-modal">
            <img src="/icons/icon-192.png" alt="Icône Burger House" />
            <div className="apple-platform">
              <AppleMark size={18} />
              Pour iPhone et iPad
            </div>
            <h3>Burger House. À portée de main.</h3>
            <p>
              Ouvrez cette adresse dans Safari, puis ajoutez l’application à votre écran d’accueil.
            </p>
            <ol>
              <li>
                <span>1</span>
                <p>
                  Touchez le bouton <strong>Partager</strong> <Share size={17} /> dans Safari.
                </p>
              </li>
              <li>
                <span>2</span>
                <p>
                  Sélectionnez <strong>Sur l’écran d’accueil</strong>.
                </p>
              </li>
              <li>
                <span>3</span>
                <p>
                  Activez <strong>Ouvrir comme app</strong> si proposé, puis touchez{' '}
                  <strong>Ajouter</strong>.
                </p>
              </li>
            </ol>
            {pendingInstall.current && (
              <button
                className="button button-primary full"
                onClick={() => void pendingInstall.current?.prompt?.()}
              >
                Installer sur cet appareil
                <Download size={17} />
              </button>
            )}
            <div className="info-box">
              <Smartphone size={18} />
              <p>
                Une icône dédiée, un affichage plein écran et une consultation hors connexion après
                la première ouverture.
              </p>
            </div>
            <a
              className="text-button"
              href="https://support.apple.com/fr-fr/guide/iphone/iphea86e5236/ios"
              target="_blank"
              rel="noreferrer"
            >
              Le guide Apple
              <ArrowUpRight size={15} />
            </a>
          </div>
        </Modal>
      )}

      {dialog?.type === 'audit' && (
        <Modal
          title="Historique d’activité"
          subtitle="Les dernières actions enregistrées."
          onClose={close}
          closing={sheetClosing}
        >
          <div className="audit-list">
            {state?.audit.length ? (
              state.audit.map((a) => (
                <div className="audit-row" key={a.id}>
                  <span className="audit-dot" />
                  <p>
                    {a.text}
                    <small>
                      {frenchDate(today(new Date(a.at)), { day: 'numeric', month: 'short' })} ·{' '}
                      {time(a.at)}
                    </small>
                  </p>
                  <Check size={14} />
                </div>
              ))
            ) : (
              <Empty
                title="Tout commence ici"
                body="Les nouvelles écritures, notes et pointages apparaîtront dans cet historique."
              />
            )}
          </div>
        </Modal>
      )}
      {dialog?.type === 'export' && (
        <Modal
          title="Exporter les données"
          subtitle={`Période : ${selectedLabel}. Format CSV, compatible Excel.`}
          onClose={close}
          closing={sheetClosing}
        >
          <div className="export-options">
            <button onClick={exportEntries}>
              <span>
                <ArrowLeftRight size={23} />
              </span>
              <div>
                <h3>Le registre financier</h3>
                <p>Recettes, dépenses et écritures annulées.</p>
              </div>
              <Download size={19} />
            </button>
            <button onClick={exportShifts}>
              <span>
                <Clock3 size={23} />
              </span>
              <div>
                <h3>Les heures de l’équipe</h3>
                <p>Services, pauses et temps réellement travaillé.</p>
              </div>
              <Download size={19} />
            </button>
          </div>
        </Modal>
      )}
      {dialog?.type === 'archive' && (
        <Modal
          title="Archiver ce salarié ?"
          subtitle="Son historique de pointage sera conservé."
          onClose={close}
          closing={sheetClosing}
        >
          <div className="confirm-content">
            <p>
              Le salarié ne pourra plus commencer de service. Ses heures restent disponibles dans
              les exports et l’historique.
            </p>
            {error && <p className="form-error">{error}</p>}
            <button
              className="button button-dark full"
              disabled={busy}
              onClick={() => void mutate({ type: 'employee.archive', id: dialog.id })}
            >
              {busy ? 'Archivage…' : 'Confirmer l’archivage'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  icon,
  caption,
  className,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  caption: string;
  className: string;
}) {
  return (
    <div className={`metric ${className}`}>
      <div>
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <strong>{value}</strong>
      <p>{caption}</p>
    </div>
  );
}
function PanelHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="panel-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
function TransactionRow({
  entry: e,
  onClick,
  detailed = false,
}: {
  entry: Entry;
  onClick: () => void;
  detailed?: boolean;
}) {
  return (
    <button
      className={`transaction-row ${detailed ? 'transaction-detailed' : ''}`}
      onClick={onClick}
    >
      <span
        className={`transaction-icon ${e.type === 'income' ? 'icon-income' : e.category === 'Ingrédients' ? 'icon-ingredient' : e.category === 'Salaires' ? 'icon-salary' : 'icon-expense'}`}
      >
        <CategoryIcon category={e.category} />
      </span>
      <span className="transaction-name">
        <strong>{e.title}</strong>
        <small>
          {e.category}
          <span>·</span>
          {frenchDate(e.date, { day: 'numeric', month: 'short' })}
          {e.supplier && detailed && ` · ${e.supplier}`}
        </small>
      </span>
      {detailed && (
        <span className="payment-label">
          {e.payment === 'Espèces' ? <Banknote size={14} /> : <CreditCard size={14} />} {e.payment}
        </span>
      )}
      <span className={`transaction-amount ${e.type === 'income' ? 'income' : ''}`}>
        {e.type === 'income' ? '+' : '−'} {money(e.amount)}
        <small>{e.type === 'income' ? 'Recette' : 'Dépense'}</small>
      </span>
      <ChevronRight size={15} className="transaction-arrow" />
    </button>
  );
}
function GoalRing({ value }: { value: number }) {
  const p = Math.min(1, Math.max(0, value));
  return (
    <svg
      width="88"
      height="88"
      viewBox="0 0 88 88"
      aria-label={`${Math.round(value * 100)} pour cent de l’objectif`}
    >
      <circle cx="44" cy="44" r="34" fill="none" stroke="#ffffff1b" strokeWidth="8" />
      <circle
        cx="44"
        cy="44"
        r="34"
        fill="none"
        stroke="#b9ee76"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${p * 213.63} 213.63`}
        transform="rotate(-90 44 44)"
      />
      <path
        d="m35 45 6 6 13-14"
        fill="none"
        stroke="#c5ee98"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function EntryDetails({
  entry: e,
  onVoid,
  busy,
  error,
  offline,
}: {
  entry: Entry;
  onVoid: () => void;
  busy: boolean;
  error: string;
  offline: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="entry-details">
      <div className={`detail-total ${e.type === 'income' ? 'income' : ''}`}>
        <span className="transaction-icon">
          <CategoryIcon category={e.category} size={23} />
        </span>
        <strong>
          {e.type === 'income' ? '+' : '−'} {money(e.amount)}
        </strong>
        <h3>{e.title}</h3>
        <span>
          {e.voidedAt
            ? 'Écriture annulée'
            : e.type === 'income'
              ? 'Recette enregistrée'
              : 'Dépense enregistrée'}
        </span>
      </div>
      <dl>
        {[
          ['Date', frenchDate(e.date)],
          ['Catégorie', e.category],
          ['Paiement', e.payment],
          ['Fournisseur / référence', e.supplier || 'Non renseigné'],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {!!e.items.length && (
        <div className="detail-items">
          <h4>Détail des articles</h4>
          {e.items.map((i, j) => (
            <div key={j}>
              <span>
                {i.name}
                <small>
                  {i.quantity} × {money(i.unitPrice)}
                </small>
              </span>
              <strong>{money(Math.round(i.quantity * i.unitPrice))}</strong>
            </div>
          ))}
        </div>
      )}
      {e.note && (
        <div className="detail-note">
          <h4>Note</h4>
          <p>{e.note}</p>
        </div>
      )}
      <p className="field-help">
        Saisie le {frenchDate(today(new Date(e.createdAt)))} à {time(e.createdAt)}.
      </p>
      {!e.voidedAt && !confirm && (
        <button className="void-button" disabled={offline} onClick={() => setConfirm(true)}>
          <Trash2 size={15} />
          Annuler cette écriture
        </button>
      )}
      {confirm && (
        <div className="void-confirm">
          <p>
            Confirmer l’annulation ? Le montant sera retiré des totaux. L’écriture restera dans
            l’historique et les exports.
          </p>
          {error && <p className="form-error">{error}</p>}
          <div>
            <button className="button button-secondary" onClick={() => setConfirm(false)}>
              Conserver
            </button>
            <button className="button button-danger" disabled={busy || offline} onClick={onVoid}>
              {busy ? 'Annulation…' : 'Confirmer l’annulation'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
