// Indeterminate spinner (currentColor). Used by buttons and loading states.
import { cn } from '../lib/cn';

export const Spinner = ({ className }: { className?: string }): JSX.Element => (
  <svg className={cn('animate-spin', className ?? 'h-5 w-5')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V4a10 10 0 0 0-10 10z" />
  </svg>
);
