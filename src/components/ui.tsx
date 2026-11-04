'use client';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  X,
  ArrowUpRight,
  ArrowDownLeft,
  ShoppingBasket,
  Users,
  Package,
  Zap,
  Building2,
  Wrench,
  Wallet,
  Banknote,
  CreditCard,
  Truck,
  MoreHorizontal,
} from 'lucide-react';
import { haptic } from '@/lib/native';
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  closing = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  closing?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; at: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [interacted, setInteracted] = useState(false);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      const first = matchMedia('(min-width: 761px)').matches
        ? 'input,select,textarea,button'
        : 'button';
      ref.current?.querySelector<HTMLElement>(first)?.focus({ preventScroll: true });
    }, 100);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab') {
        const els = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]',
          ) ?? [],
        );
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      before?.focus({ preventScroll: true });
    };
  }, [onClose]);
  function release() {
    if (!drag.current) return;
    const velocity = offset / Math.max(1, performance.now() - drag.current.at);
    drag.current = null;
    if (offset > 110 || (offset > 40 && velocity > 0.5)) {
      haptic();
      onClose();
    }
    setOffset(0);
  }
  return (
    <div
      className={`modal-overlay ${closing ? 'is-closing' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'modal-wide' : ''} ${offset ? 'is-dragging' : ''} ${interacted ? 'is-settled' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        ref={ref}
        style={offset ? { transform: `translate3d(0,${offset}px,0)` } : undefined}
      >
        <div
          className="sheet-drag-zone"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            setInteracted(true);
            drag.current = { y: e.clientY, at: performance.now() };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current) setOffset(Math.max(0, e.clientY - drag.current.y));
          }}
          onPointerUp={release}
          onPointerCancel={() => {
            drag.current = null;
            setOffset(0);
          }}
        >
          <span className="sheet-handle" />
        </div>
        <header className="modal-head">
          <div>
            <h2 id={id}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button sheet-close" aria-label="Fermer" onClick={onClose}>
            <X size={17} strokeWidth={2.5} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function CategoryIcon({ category, size = 19 }: { category: string; size?: number }) {
  const Icon =
    (
      {
        Ingrédients: ShoppingBasket,
        Salaires: Users,
        Emballages: Package,
        Énergie: Zap,
        'Loyer & charges': Building2,
        Équipement: Wrench,
        CB: CreditCard,
        Mypos: CreditCard,
        Gfd: ShoppingBasket,
        Gasoil: ShoppingBasket,
        Carrefour: ShoppingBasket,
        Uber: Truck,
        'Sur place': CreditCard,
        'À emporter': Banknote,
        Livraison: Truck,
        Autres: MoreHorizontal,
      } as Record<string, typeof Wallet>
    )[category] ?? Wallet;
  return <Icon size={size} strokeWidth={1.85} />;
}
export function Avatar({
  name,
  color = 'lime',
  small = false,
}: {
  name: string;
  color?: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar avatar-${color} ${small ? 'avatar-small' : ''}`} aria-hidden="true">
      {name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}
export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Wallet size={29} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
export function Direction({ income }: { income: boolean }) {
  return income ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div
      className={`segmented has-thumb ${className}`}
      role="group"
      aria-label={label}
      style={{ '--segment-count': options.length, '--segment-index': index } as CSSProperties}
    >
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
