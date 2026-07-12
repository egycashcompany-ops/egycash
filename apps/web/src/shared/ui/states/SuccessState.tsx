// Success confirmation panel (e.g. after a completed multi-step action).
import { type ReactNode } from 'react';
import { CheckIcon } from '../icons';

export const SuccessState = ({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element => (
  <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
    <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
      <CheckIcon className="h-6 w-6" />
    </span>
    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
    {description !== undefined && (
      <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
    )}
    {action !== undefined && <div className="mt-2">{action}</div>}
  </div>
);
