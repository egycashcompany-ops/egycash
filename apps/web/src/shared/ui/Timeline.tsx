// Vertical timeline (RTL-safe: the rail sits on the reading-start edge). Drives the recruitment
// Employee Timeline and any entity history view. Each entry has a tone-coloured node.
import { type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { type Tone } from './Badge';

const NODE: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-brand-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-sky-500',
};

export interface TimelineEntry {
  id: string;
  title: string;
  meta?: string;
  description?: string;
  tone?: Tone;
  icon?: ReactNode;
}

export const Timeline = ({ entries }: { entries: TimelineEntry[] }): JSX.Element => (
  <ol className="relative ms-2 space-y-6 border-s border-slate-200 ps-6 dark:border-slate-800">
    {entries.map((entry) => (
      <li key={entry.id} className="relative">
        <span
          className={cn(
            'absolute -start-[1.65rem] top-1 grid h-3.5 w-3.5 place-items-center rounded-full ring-4 ring-slate-50 dark:ring-slate-950',
            NODE[entry.tone ?? 'brand'],
          )}
        >
          {entry.icon}
        </span>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{entry.title}</p>
          {entry.meta !== undefined && (
            <span className="text-xs text-slate-400 dark:text-slate-500">{entry.meta}</span>
          )}
        </div>
        {entry.description !== undefined && (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{entry.description}</p>
        )}
      </li>
    ))}
  </ol>
);
