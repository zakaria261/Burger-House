import type { SVGProps } from 'react';
export type SymbolName =
  | 'summary'
  | 'activity'
  | 'team'
  | 'inventory'
  | 'notes'
  | 'settings'
  | 'bell'
  | 'moon'
  | 'sun'
  | 'display'
  | 'iphone'
  | 'checkmark';
/** Original vector interface symbols, drawn on a consistent 24-point grid. */
export function Symbol({
  name,
  size = 24,
  filled = false,
  ...props
}: { name: SymbolName; size?: number; filled?: boolean } & SVGProps<SVGSVGElement>) {
  const common = {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    ...props,
  };
  switch (name) {
    case 'summary':
      return (
        <svg {...common}>
          {[3.5, 13.5].flatMap((x, i) =>
            [3.5, 13.5].map((y, j) => (
              <rect
                key={i + '-' + j}
                x={x}
                y={y}
                width="7"
                height="7"
                rx="2"
                fill={filled ? 'currentColor' : 'none'}
                strokeWidth={filled ? 0 : 1.8}
              />
            )),
          )}
        </svg>
      );
    case 'activity':
      return (
        <svg {...common}>
          <rect
            x="3"
            y="12"
            width="4"
            height="8"
            rx="1.3"
            fill={filled ? 'currentColor' : 'none'}
          />
          <rect
            x="10"
            y="7"
            width="4"
            height="13"
            rx="1.3"
            fill={filled ? 'currentColor' : 'none'}
          />
          <rect
            x="17"
            y="3"
            width="4"
            height="17"
            rx="1.3"
            fill={filled ? 'currentColor' : 'none'}
          />
        </svg>
      );
    case 'team':
      return (
        <svg {...common}>
          <circle cx="9" cy="7.5" r="3.3" fill={filled ? 'currentColor' : 'none'} />
          <path d="M2.5 20v-1.3a6.5 6.5 0 0 1 13 0V20z" fill={filled ? 'currentColor' : 'none'} />
          <path d="M16 4.4a3.2 3.2 0 0 1 0 6.2M18 14a5.2 5.2 0 0 1 3.5 4.9V20h-2.7" />
        </svg>
      );
    case 'inventory':
      return (
        <svg {...common}>
          <path
            d="M3.5 7.4 12 3l8.5 4.4v9.2L12 21l-8.5-4.4z"
            fill={filled ? 'currentColor' : 'none'}
          />
          <path
            d="M3.8 7.6 12 11.9l8.2-4.3M12 11.9V20.6M7.8 5.2l8.3 4.4"
            stroke={filled ? 'var(--symbol-cutout, var(--surface))' : 'currentColor'}
            strokeWidth="1.5"
          />
        </svg>
      );
    case 'notes':
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="19" rx="3" fill={filled ? 'currentColor' : 'none'} />
          <path
            d="M4.5 8h15M8 12.5h8M8 16.5h5"
            stroke={filled ? 'var(--symbol-cutout, var(--surface))' : 'currentColor'}
            strokeWidth="1.5"
          />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <path
            d="m10 2-.5 2.4-2 .9-2.1-1.2L2.8 7l1.4 2-.3 2.2L2 12.5l1.2 3.7 2.5.1 1.6 1.5.3 2.5 3.8.7 1.4-2 2.2-.4 2 1.4 2.9-2.6-1.1-2.2.8-2 2.4-.6V8.8l-2.4-.6-.8-2 1.1-2.2L17 1.5l-2 1.4-2.2-.4L11.4 2z"
            transform="translate(0 .5) scale(.98)"
            fill={filled ? 'currentColor' : 'none'}
          />
          <circle
            cx="12"
            cy="11.8"
            r="3.2"
            stroke={filled ? 'var(--symbol-cutout, var(--surface))' : 'currentColor'}
            strokeWidth="1.8"
          />
        </svg>
      );
    case 'bell':
      return (
        <svg {...common}>
          <path
            d="M5 16.5h14l-1.7-2.6V9a5.3 5.3 0 0 0-10.6 0v4.9z"
            fill={filled ? 'currentColor' : 'none'}
          />
          <path d="M10 20h4M12 2v1.5" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...common}>
          <path
            d="M20.5 14.1A8.8 8.8 0 0 1 9.9 3.5a9 9 0 1 0 10.6 10.6Z"
            fill={filled ? 'currentColor' : 'none'}
          />
        </svg>
      );
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" fill={filled ? 'currentColor' : 'none'} />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      );
    case 'display':
      return (
        <svg {...common}>
          <rect x="2.5" y="3.5" width="19" height="13" rx="2.3" />
          <path d="M8 21h8M12 17v4m0-17v12" />
        </svg>
      );
    case 'iphone':
      return (
        <svg {...common}>
          <rect x="6" y="1.5" width="12" height="21" rx="3" />
          <path d="M10 4h4M10 20h4" strokeWidth="1.5" />
        </svg>
      );
    case 'checkmark':
      return (
        <svg {...common}>
          <path d="m5 12 4.5 4.5L19 6.8" strokeWidth="2.5" />
        </svg>
      );
  }
}
/** Apple mark is used only to identify the iPhone installation platform. */
export function AppleMark({ size = 22, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M16.36 1.43c.09 1.18-.39 2.35-1.12 3.2-.73.85-1.9 1.5-3.04 1.42-.14-1.16.43-2.39 1.12-3.14.77-.88 2.05-1.53 3.04-1.48ZM20.48 17.2c-.49 1.13-.73 1.64-1.37 2.64-.89 1.4-2.15 3.15-3.71 3.16-1.39.02-1.75-.9-3.63-.89-1.89.02-2.29.9-3.68.89-1.56-.01-2.75-1.59-3.64-2.99-2.49-3.93-2.75-8.55-1.21-11.01C4.32 7.25 6.02 6.2 7.63 6.2c1.64 0 2.67.91 4.03.91 1.33 0 2.13-.91 4.01-.91 1.43 0 2.94.78 4.01 2.12-3.52 1.92-2.95 6.91.8 8.88Z" />
    </svg>
  );
}
