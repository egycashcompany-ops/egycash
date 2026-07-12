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

export const Badge = ({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}): JSX.Element => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
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
