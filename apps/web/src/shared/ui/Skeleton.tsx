// Content placeholder shimmer for loading states.
import { cn } from '../lib/cn';

export const Skeleton = ({ className }: { className?: string }): JSX.Element => (
  <div className={cn('animate-pulse rounded bg-slate-200 dark:bg-slate-700', className)} aria-hidden="true" />
);
