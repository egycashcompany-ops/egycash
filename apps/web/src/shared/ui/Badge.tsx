// Pill badge + StatusBadge. `tone` maps to a semantic colour; StatusBadge adds a leading dot
// for lifecycle states. Features map their domain status → tone at the call site.
import { type ReactNode } from 'react';
import { cn } from '../lib/cn';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  brand: 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  danger: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-brand-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-sky-500',
};

/**
 * `sm` is for a chip that CLASSIFIES a row rather than flagging it — a type, a category — where
 * several sit in a column and none of them is the thing you scan for. A size prop rather than a
 * padding class from the caller: `cn` is a plain joiner, so a `px-2` handed in beside the default
 * `px-2.5` would leave the winner to stylesheet order.
 */
const SIZE = {
  // `leading-4` is not decoration: an arbitrary font size sets the size ONLY, so the chip would
  // inherit the cell's 20px line height and end up TALLER than the `md` beside it — the opposite
  // of what asking for a small badge means.
  sm: 'gap-1 px-2 py-0.5 text-[11px] leading-4',
  md: 'gap-1.5 px-2.5 py-0.5 text-xs',
} as const;

export const Badge = ({
  tone = 'neutral',
  size = 'md',
  className,
  children,
}: {
  tone?: Tone;
  size?: keyof typeof SIZE;
  className?: string;
  children: ReactNode;
}): JSX.Element => (
  <span
    className={cn(
      'inline-flex items-center rounded-full font-medium',
      SIZE[size],
      TONE[tone],
      className,
    )}
  >
    {children}
  </span>
);

export const StatusBadge = ({ tone = 'neutral', label }: { tone?: Tone; label: string }): JSX.Element => (
  <Badge tone={tone}>
    <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone])} />
    {label}
  </Badge>
);
