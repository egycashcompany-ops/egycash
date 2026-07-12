// Full-height centered message used by 403/404 and other whole-screen states.
import { type ReactNode } from 'react';

export const StatusMessage = ({
  icon,
  code,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  code?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
    {code !== undefined && (
      <p className="text-5xl font-bold tracking-tight text-slate-200 dark:text-slate-700">{code}</p>
    )}
    {icon !== undefined && <div className="text-slate-300 dark:text-slate-600">{icon}</div>}
    <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h1>
    {description !== undefined && (
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>
    )}
    {action !== undefined && <div className="mt-2">{action}</div>}
  </div>
);
