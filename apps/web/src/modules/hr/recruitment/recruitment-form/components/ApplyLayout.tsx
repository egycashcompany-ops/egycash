// The public application page's frame.
//
// A brand band carries who is asking, the job, and the four steps (each lights up as it is done);
// the form surface rises out of it, with a side card on wide screens listing what to have ready.
// Everything is the app's own palette — brand, slate, white — and its Cairo display type: a
// company's application, not a template.
import { type ReactNode } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { cn } from '../../../../../shared/lib/cn';
import { BrandMark } from '../../../../../shared/ui/BrandMark';
import { MARK_BAND_PATH, MARK_RIBBON_PATH } from '../../../../../shared/ui/brand-mark-paths';
import { EgycashLogo } from '../../../../../shared/ui/EgycashLogo';
import { AlertIcon, BadgeIcon, CheckIcon, ClipboardIcon, FileIcon, LockIcon, ShieldIcon } from '../../../../../shared/ui/icons';

export interface ApplyStep {
  id: string;
  label: string;
  done: boolean;
}

export const DISPLAY = 'font-[Cairo,system-ui,sans-serif]';
// The form must read clearly off the page: solid, a step lighter than the ground, a visible edge and
// a soft brand glow. (A translucent card on a dark ground disappeared into it.)
const SURFACE =
  'rounded-lg border border-slate-200 bg-white shadow-[0_10px_40px_-12px_rgb(30_27_75/0.25)] dark:border-slate-700/80 dark:bg-slate-800/95 dark:shadow-[0_0_0_1px_rgb(99_102_241/0.12),0_20px_60px_-15px_rgb(0_0_0/0.8)]';

export const jumpTo = (id: string): void => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/**
 * The company's mark, tiled across the whole page at a slight angle — faint enough to read through,
 * present enough that the page is unmistakably EGYCASH's. Fades as it goes down the page.
 */
const LogoPattern = (): JSX.Element => (
  <svg
    aria-hidden
    className="pointer-events-none absolute inset-0 h-full w-full text-brand-900/[0.06] [mask-image:linear-gradient(to_bottom,black_0%,black_45%,rgb(0_0_0/0.35)_100%)] dark:text-white/[0.045]"
  >
    <defs>
      <pattern id="apply-logo-tile" width="1400" height="1400" patternUnits="userSpaceOnUse" patternTransform="rotate(-14) scale(0.07)">
        <g fill="currentColor">
          <path d={MARK_RIBBON_PATH} />
          <path d={MARK_BAND_PATH} />
        </g>
        <g fill="currentColor" transform="translate(700 700)">
          <path d={MARK_RIBBON_PATH} />
          <path d={MARK_BAND_PATH} />
        </g>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#apply-logo-tile)" />
  </svg>
);

/** The band's content area; the colour behind it is the page's own gradient, so there is no edge. */
const Band = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="relative">
    {/* The company's mark, large and faint. */}
    <BrandMark
      size="fill"
      variant="onBrand"
      className="pointer-events-none absolute -bottom-40 end-[-4rem] h-[30rem] opacity-[0.08] sm:end-8"
    />
    <div className="relative mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">{children}</div>
  </div>
);

export const ApplyShell = ({ header, children }: { header: ReactNode; children: ReactNode }): JSX.Element => (
  <div className="relative min-h-screen overflow-x-hidden bg-slate-100 font-[Cairo,system-ui,sans-serif] dark:bg-[#04050e]">
    {/* One continuous ground: the brand colour at the top melts into the page, so the header and
        the form read as one surface rather than a banner stuck on a page. */}
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[46rem] bg-gradient-to-b from-brand-900 via-brand-900/85 to-transparent dark:from-brand-950 dark:via-brand-950/80"
    />
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-[22rem] h-[40rem] w-[56rem] max-w-[160vw] -translate-x-1/2 rounded-full bg-brand-500/10 blur-3xl dark:bg-brand-600/15"
    />
    <LogoPattern />
    <Band>{header}</Band>
    <div className="relative mx-auto -mt-16 w-full max-w-5xl px-4 pb-32 sm:px-6 lg:pb-16">{children}</div>
  </div>
);

/** The band's text: logo, eyebrow, job title and intro. */
export const ApplyHeader = ({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children?: ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <>
      <EgycashLogo tone="white" className="h-7 sm:h-8" />
      <p className="mt-8 text-xs font-semibold text-brand-200">{t('apply.eyebrow')}</p>
      <h1 className={cn(DISPLAY, 'mt-1 max-w-2xl text-3xl font-extrabold leading-tight text-white sm:text-4xl')}>{title}</h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-brand-100/80">{intro}</p>
      {children}
    </>
  );
};

/** The four steps across the band; each lights up when done and jumps to its section. */
export const ApplySteps = ({ steps }: { steps: ApplyStep[] }): JSX.Element => {
  const t = useT();
  return (
    <nav aria-label={t('apply.rail.checklist')} className="mt-8">
      <ol className="grid grid-cols-4 gap-2 sm:gap-3">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => jumpTo(s.id)}
              className="group w-full text-start focus-visible:outline-none"
            >
              <span
                aria-hidden
                className={cn('block h-1 rounded-full transition-colors', s.done ? 'bg-white' : 'bg-white/20 group-hover:bg-white/35')}
              />
              <span className="mt-2.5 flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold tabular-nums transition-colors',
                    s.done ? 'bg-white text-brand-800' : 'border border-white/30 text-white/70',
                  )}
                >
                  {s.done ? <CheckIcon className="h-3 w-3" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'hidden truncate text-xs font-semibold sm:block group-focus-visible:underline',
                    s.done ? 'text-white' : 'text-white/70',
                  )}
                >
                  {s.label}
                </span>
                <span className="sr-only">
                  {s.label} — {s.done ? t('apply.rail.stepDone') : t('apply.rail.stepTodo')}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
};

/** A message panel for the start or end of the journey (thank-you, link gone). */
export const ApplyNotice = ({
  tone,
  title,
  children,
}: {
  tone: 'success' | 'neutral';
  title: string;
  children: ReactNode;
}): JSX.Element => (
  <div className={cn(SURFACE, 'mx-auto max-w-lg px-6 py-10 text-center sm:px-10')}>
    <span
      className={cn(
        'mx-auto grid h-14 w-14 place-items-center rounded-full ring-8',
        tone === 'success'
          ? 'bg-emerald-50 text-emerald-600 ring-emerald-50/50 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-950/30'
          : 'bg-slate-100 text-slate-500 ring-slate-100/50 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-800/40',
      )}
    >
      {tone === 'success' ? <CheckIcon className="h-7 w-7" /> : <AlertIcon className="h-7 w-7" />}
    </span>
    <h2 className={cn(DISPLAY, 'mt-5 text-2xl font-bold text-slate-900 dark:text-slate-50')}>{title}</h2>
    <div className="mt-3 space-y-3 text-sm text-slate-600 dark:text-slate-400">{children}</div>
  </div>
);

/** Wide screens: what to have ready, and who sees it. */
export const ApplyAside = (): JSX.Element => {
  const t = useT();
  const items: { icon: JSX.Element; text: string; note?: string }[] = [
    { icon: <BadgeIcon className="h-4 w-4" />, text: t('apply.aside.idCard') },
    { icon: <ShieldIcon className="h-4 w-4" />, text: t('apply.aside.military'), note: t('apply.aside.militaryNote') },
    { icon: <FileIcon className="h-4 w-4" />, text: t('apply.aside.papers'), note: t('apply.optional') },
  ];
  return (
    <aside className="hidden lg:block">
      <div className={cn(SURFACE, 'sticky top-6 p-5')}>
        <p className={cn(DISPLAY, 'flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-50')}>
          <ClipboardIcon className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          {t('apply.aside.title')}
        </p>
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.text} className="flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                {item.icon}
              </span>
              <span className="pt-1 text-sm leading-snug text-slate-700 dark:text-slate-200">
                {item.text}
                {item.note !== undefined && (
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{item.note}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('apply.aside.time')}</p>
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('apply.private')}
          </p>
        </div>
      </div>
    </aside>
  );
};

/** The one form surface. Sections hang off a single line that runs down it, step to step. */
export const ApplySurface = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className={cn(SURFACE, 'overflow-hidden px-3 pb-5 sm:px-8 sm:pb-8')}>{children}</div>
);

/** The line between two steps: brand once the step above it is done. */
const Rail = ({ lit, className }: { lit: boolean; className?: string }): JSX.Element => (
  <span
    aria-hidden
    className={cn(
      'mx-auto block w-0.5 rounded-full transition-colors duration-500',
      lit ? 'bg-brand-500 dark:bg-brand-400' : 'bg-slate-200 dark:bg-slate-600',
      className,
    )}
  />
);

/** The step's marker on the line. */
const Node = ({ done, children }: { done: boolean; children: ReactNode }): JSX.Element => (
  <span
    aria-hidden
    className={cn(
      'relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-extrabold sm:h-10 sm:w-10 sm:text-sm tabular-nums transition-colors duration-300',
      done
        ? 'bg-brand-600 text-white shadow-[0_0_0_4px] shadow-brand-100 dark:shadow-brand-950'
        : 'border-2 border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
    )}
  >
    {children}
  </span>
);

/** One numbered step of the form, joined to the steps above and below it. */
export const ApplySection = ({
  id,
  n,
  title,
  intro,
  done,
  prevDone,
  children,
}: {
  id: string;
  n: number;
  title: string;
  intro?: string;
  done: boolean;
  /** The step above; null for the first. Colours the line coming into this one. */
  prevDone: boolean | null;
  children: ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-6 grid-cols-[2rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-x-6">
      <div className="flex flex-col items-center">
        {prevDone === null ? <span className="h-8 sm:h-10" /> : <Rail lit={prevDone} className="h-8 sm:h-10" />}
        <Node done={done}>{done ? <CheckIcon className="h-5 w-5" /> : String(n).padStart(2, '0')}</Node>
        <Rail lit={done} className="mt-0 flex-1" />
      </div>
      <div className="min-w-0 pb-4 pt-8 sm:pt-10">
        <div className="flex min-h-8 flex-col justify-center sm:min-h-10">
          <h2 id={`${id}-title`} className="text-lg font-bold leading-snug text-slate-900 dark:text-slate-50">
            {title}
            {done && <span className="sr-only"> — {t('apply.rail.stepDone')}</span>}
          </h2>
          {intro !== undefined && (
            <p className="mt-0.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{intro}</p>
          )}
        </div>
        <div className="mt-4 sm:mt-5 sm:rounded-lg sm:border sm:border-slate-100 sm:bg-slate-50/60 sm:p-5 dark:sm:border-slate-700/70 dark:sm:bg-slate-900/50">
          {children}
        </div>
      </div>
    </section>
  );
};

/** The end of the line: the send step. */
export const ApplyFinish = ({
  ready,
  hint,
  children,
}: {
  /** Every step done — the last stretch of line and the marker light up. */
  ready: boolean;
  hint: ReactNode;
  children: ReactNode;
}): JSX.Element => (
  <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-x-6">
    <div className="flex flex-col items-center">
      <Rail lit={ready} className="h-8 sm:h-10" />
      <Node done={ready}>
        <SendIcon />
      </Node>
    </div>
    <div className="flex min-w-0 flex-col gap-3 pt-8 sm:flex-row sm:items-center sm:justify-between sm:pt-10">
      <p className="text-sm text-slate-500 dark:text-slate-400" aria-live="polite">{hint}</p>
      {children}
    </div>
  </div>
);

const SendIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 h-[18px] w-[18px] rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
  </svg>
);

export const ApplyError = ({ children }: { children: ReactNode }): JSX.Element => (
  <div
    role="alert"
    className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
  >
    <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
    <span>{children}</span>
  </div>
);
