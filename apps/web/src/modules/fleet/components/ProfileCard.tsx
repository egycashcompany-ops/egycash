// «عاوز اعمل الشاشتين دول … زى ما هى»: the pieces the vehicle and driver profile pages are drawn
// with, in the reference's own classes — its surfaces, borders, sizes and colours.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../../shared/lib/cn';
import { BoardIcon } from './FuelCardBoard';

/** The reference's surfaces, each with a light-mode counterpart. */
export const SURFACE = {
  card: 'bg-white dark:bg-[#111827]',
  inner: 'bg-slate-50 dark:bg-[#162032]',
  border: 'border-slate-200 dark:border-[#1f293d]',
} as const;

/** A KPI card across the top of the vehicle's page. */
export const VehicleKpi = ({
  icon,
  hoverTone,
  label,
  value,
  unit,
  caption,
  captionTone,
}: {
  icon: readonly string[];
  /** The icon's colour on hover. */
  hoverTone: string;
  label: string;
  value: string | undefined;
  unit?: string | undefined;
  caption?: string | undefined;
  /** An amber caption for an alarm, slate otherwise. */
  captionTone?: string | undefined;
}): JSX.Element => (
  <div
    className={cn(
      'group relative overflow-hidden rounded-xl border p-5 shadow-md transition-all hover:border-slate-300 dark:hover:border-[#2a374f]',
      SURFACE.card,
      SURFACE.border,
    )}
  >
    <div className="flex items-start justify-between">
      <div className="space-y-1">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <div className="flex items-baseline gap-1.5">
          <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {value ?? '—'}
          </h3>
          {unit !== undefined && value !== undefined && (
            <span className="text-xs font-semibold text-indigo-500 dark:text-indigo-400">
              {unit}
            </span>
          )}
        </div>
        {caption !== undefined && (
          <p
            className={cn(
              'mt-1 text-[11px] leading-snug',
              captionTone ?? 'text-slate-500',
            )}
            title={caption}
          >
            {caption}
          </p>
        )}
      </div>
      <div
        className={cn(
          'rounded-lg border p-2.5 text-slate-500 transition-colors dark:text-slate-300',
          SURFACE.inner,
          SURFACE.border,
          hoverTone,
        )}
      >
        <BoardIcon d={icon} className="h-6 w-6" />
      </div>
    </div>
  </div>
);

/** A section card of the vehicle's page: a tinted head with an icon and a tag, a body, a foot. */
export const VehicleSection = ({
  icon,
  title,
  subtitle,
  tag,
  footer,
  children,
  bodyClass,
}: {
  icon: readonly string[];
  title: string;
  subtitle?: string;
  tag?: string;
  footer?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
}): JSX.Element => (
  <section
    className={cn(
      'flex flex-col justify-between overflow-hidden rounded-xl border shadow-lg',
      SURFACE.card,
      SURFACE.border,
    )}
  >
    <div>
      <div
        className={cn(
          'flex items-center justify-between border-b bg-slate-50/60 p-4 sm:p-5 dark:bg-[#162032]/60',
          SURFACE.border,
        )}
      >
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-2 text-indigo-500 dark:text-indigo-400">
            <BoardIcon d={icon} className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 sm:text-lg dark:text-white">
              {title}
            </h2>
            {subtitle !== undefined && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>
        </div>
        {tag !== undefined && (
          <span className="rounded border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {tag}
          </span>
        )}
      </div>
      <div className={bodyClass ?? 'grid grid-cols-1 gap-x-6 gap-y-5 p-5 sm:grid-cols-2 sm:p-6'}>
        {children}
      </div>
    </div>
    {footer !== undefined && (
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 border-t bg-slate-50/30 px-5 py-3 text-[11px] text-slate-500 dark:bg-[#162032]/30',
          SURFACE.border,
        )}
      >
        {footer}
      </div>
    )}
  </section>
);

/** One fact of a vehicle section: a small name over its value. */
export const VehicleItem = ({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}): JSX.Element => (
  <div className={cn('space-y-1', className)}>
    <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
    <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{children}</div>
  </div>
);

/** A row of «السجلات والأرشيف». */
export const RecordRow = ({
  to,
  icon,
  label,
  tag,
  tagTone,
}: {
  to: string;
  icon: readonly string[];
  label: string;
  tag?: string | undefined;
  /** The tag's colours: slate by default, green for «سجل نظيف», indigo for «سائق نشط». */
  tagTone?: string | undefined;
}): JSX.Element => (
  <Link
    to={to}
    className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-slate-50 sm:px-6 dark:hover:bg-[#162032]/50"
  >
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'rounded-lg p-2 text-slate-400 transition-colors group-hover:text-indigo-400',
          SURFACE.inner,
        )}
      >
        <BoardIcon d={icon} className="h-4 w-4" />
      </span>
      <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900 dark:text-slate-200 dark:group-hover:text-white">
        {label}
      </span>
      {tag !== undefined && (
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs',
            tagTone ??
              'border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
          )}
        >
          {tag}
        </span>
      )}
    </div>
    <BoardIcon
      d={['M15 19l-7-7 7-7']}
      className="h-4 w-4 text-slate-500 transition-transform group-hover:-translate-x-1 group-hover:text-slate-300"
    />
  </Link>
);

/** The driver page's frosted panel. */
export const GLASS_PANEL =
  'relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-7 dark:border-white/[0.07] dark:bg-transparent dark:bg-[linear-gradient(135deg,rgba(20,28,48,0.75)_0%,rgba(15,23,42,0.6)_100%)] dark:backdrop-blur-xl';

/** One fact of the driver's file, in its own frosted tile. */
export const GlassTile = ({
  icon,
  label,
  value,
  aside,
}: {
  icon: readonly string[];
  label: string;
  value: ReactNode;
  aside?: ReactNode;
}): JSX.Element => (
  <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/30 hover:shadow-xl dark:border-white/5 dark:bg-[rgba(26,36,61,0.45)]">
    <span className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
      <BoardIcon d={icon} className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
      {label}
    </span>
    <div className="mt-1 flex items-center justify-between gap-2">
      <div className="min-w-0 text-sm font-bold text-slate-900 dark:text-white">{value}</div>
      {aside}
    </div>
  </div>
);

/** The first letters of a name — «ابراهيم السيد» gives «ا س»: the article is not the name. */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => (word.startsWith('ال') && word.length > 2 ? word.charAt(2) : word.charAt(0)))
    .join(' ');

/** «2026-09-29T20:39…» → «2026/09/29» and «08:39 م», the way the reference writes a moment. */
export const dayAndTime = (iso: string): { day: string; time: string } => {
  const at = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const hours = at.getHours();
  return {
    day: `${at.getFullYear()}/${pad(at.getMonth() + 1)}/${pad(at.getDate())}`,
    time: `${pad(hours % 12 === 0 ? 12 : hours % 12)}:${pad(at.getMinutes())} ${hours < 12 ? 'ص' : 'م'}`,
  };
};

/** The profile pages' own icons. */
export const PROFILE_ICON = {
  person: ['M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'],
  clock: ['M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'],
  gear: [
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  ],
  warn: [
    'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  ],
  calendar: [
    'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  ],
  doc: [
    'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  ],
  bank: ['M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z'],
  archive: [
    'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  ],
  bolt: ['M13 10V3L4 14h7v7l9-11h-7z'],
  image: [
    'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  ],
  printer: [
    'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z',
  ],
  refresh: [
    'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  ],
  edit: [
    'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  ],
  chevron: ['M15 19l-7-7 7-7'],
  idCard: [
    'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2',
  ],
  briefcase: [
    'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  ],
  shield: [
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  ],
  pin: [
    'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z',
    'M15 11a3 3 0 11-6 0 3 3 0 016 0z',
  ],
  building: [
    'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  ],
  phone: [
    'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  ],
  clipboard: [
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  ],
  ban: [
    'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
  ],
  check: ['M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'],
  chart: ['M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z'],
  list: [
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  ],
  userX: ['M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6'],
  plus: ['M12 4v16m8-8H4'],
  box: ['M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'],
  external: ['M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'],
  truck: [
    'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z',
    'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1',
  ],
} as const;
