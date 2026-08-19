// Form primitives (controlled, RTL-safe, dark-aware). Framework-agnostic: they work with
// component state today and are shaped to back react-hook-form + the shared Zod schemas from
// packages/contracts later without changing call sites (ADR-013). `Field` wires label/hint/error;
// `error` on a control flips its ring red.
import {
  forwardRef,
  useEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn';
import { ChevronIcon } from './icons';

const controlBase =
  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800';
const ring = (error: boolean): string =>
  error
    ? 'border-red-400 focus:border-red-500'
    : 'border-slate-300 focus:border-brand-400 dark:border-slate-700';

export const Field = ({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  children,
}: {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}): JSX.Element => (
  <div className="space-y-1.5">
    {label !== undefined && (
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
    )}
    {children}
    {error !== undefined ? (
      <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
    ) : hint !== undefined ? (
      <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    ) : null}
  </div>
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error = false, className, ...rest }, ref) => (
    <input ref={ref} className={cn(controlBase, ring(error), className)} {...rest} />
  ),
);
Input.displayName = 'Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error = false, className, rows = 4, ...rest }, ref) => (
    <textarea ref={ref} rows={rows} className={cn(controlBase, ring(error), className)} {...rest} />
  ),
);
Textarea.displayName = 'Textarea';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ error = false, className, children, ...rest }, ref) => (
    <div className="relative">
      <select ref={ref} className={cn(controlBase, ring(error), 'appearance-none pe-9', className)} {...rest}>
        {children}
      </select>
      <ChevronIcon className="pointer-events-none absolute inset-y-0 end-3 my-auto h-4 w-4 text-slate-400" />
    </div>
  ),
);
Select.displayName = 'Select';

/**
 * `indeterminate` is a DOM PROPERTY, not an attribute — React cannot set it through JSX, so it has
 * to be written onto the element after every render. Without it a "select all" over a partly
 * selected group has only two states to say three things, and would have to claim either "all" or
 * "none" when neither is true.
 *
 * It drives `aria-checked="mixed"` as well as the visual state, so the third state is announced
 * rather than merely drawn.
 */
export const Checkbox = ({
  label,
  className,
  indeterminate = false,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  indeterminate?: boolean;
}): JSX.Element => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={cn('flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200', className)}>
      <input
        ref={ref}
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        {...(indeterminate ? { 'aria-checked': 'mixed' as const } : {})}
        {...rest}
      />
      {label}
    </label>
  );
};

/**
 * An on/off switch — a checkbox wearing `role="switch"`.
 *
 * Built on a real `<input type="checkbox">` rather than a styled `<button>`: it arrives keyboard
 * operable, focusable and form-associated for free, and `role="switch"` is what tells a screen
 * reader that "on/off" is the question rather than "checked/unchecked".
 *
 * The thumb is moved by flex ALIGNMENT rather than a transform. `peer-checked:` compiles to a
 * general-sibling selector, so it can only reach the track — never a span nested inside it — and a
 * translate on the thumb would simply never fire. Alignment also follows the writing direction on
 * its own, so the switch travels toward the end of the track in Arabic without an `rtl:` override.
 */
export const Switch = ({
  label,
  description,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  description?: string;
}): JSX.Element => (
  <label className={cn('flex cursor-pointer items-start gap-2.5 text-sm', className)}>
    <input type="checkbox" role="switch" className="peer sr-only" {...rest} />
    <span
      aria-hidden="true"
      className="mt-0.5 inline-flex h-5 w-9 shrink-0 items-center justify-start rounded-full bg-slate-300 p-0.5 transition-colors peer-checked:justify-end peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 dark:bg-slate-600"
    >
      <span className="h-4 w-4 rounded-full bg-white shadow" />
    </span>
    <span className="min-w-0">
      <span className="block text-slate-700 dark:text-slate-200">{label}</span>
      {description !== undefined && (
        <span className="block text-xs text-slate-500 dark:text-slate-400">{description}</span>
      )}
    </span>
  </label>
);

export const Form = ({
  onSubmit,
  className,
  children,
}: {
  onSubmit: () => void;
  className?: string;
  children: ReactNode;
}): JSX.Element => (
  <form
    noValidate
    onSubmit={(e) => {
      e.preventDefault();
      onSubmit();
    }}
    className={cn('space-y-4', className)}
  >
    {children}
  </form>
);

export const FormActions = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="flex items-center justify-end gap-2 pt-2">{children}</div>
);
