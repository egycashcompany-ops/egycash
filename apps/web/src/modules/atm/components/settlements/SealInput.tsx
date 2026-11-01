// The keyboard-wedge field (§9.6; the IT scan pattern, `it/pages/AssetScanPage.tsx`): a scanner is
// a keyboard that types the code and presses Enter — or Tab, on some models.
//
//   · `dir="ltr"`, no autocomplete, no spell check: the value is a code, not a word;
//   · FOCUSING SELECTS THE TEXT, so a scan into a filled field REPLACES the value instead of
//     appending a second code to the first;
//   · Enter, or a Tab the scanner appends (`sealKeyAction`), is `preventDefault`ed — Enter never
//     submits a half-scanned form, Tab never leaves it — and hands the field to the page, which
//     cleans the value, runs the local checks and moves the focus on.
//
// A DUPLICATE IS A WARNING, NEVER A BLOCK (S-7): it draws an orange border and the page says where
// else the value is recorded; the field stays editable and saving stays possible.
import { forwardRef, type ReactNode } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { sealKeyAction } from '../../lib/preparation-form';

export interface SealInputProps {
  id: string;
  /** «سيلز الكاسيت 3» / «QR الشوال الأول» — the field's accessible name (§9.10). */
  label: string;
  /** What sits beside the label: the cassette's denomination and notes, «اختياري». */
  caption?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Enter or a scanner's Tab: the page cleans, checks and moves on. */
  onAdvance: () => void;
  /** A duplicate, local or found by the server: orange, never blocking. */
  duplicate?: boolean;
  /** A value the server or the user needs to look at (Arabic letters, a conflict). */
  warning?: boolean;
  disabled?: boolean;
  /** The warning texts under the field, read out politely (§9.10). */
  children?: ReactNode;
}

export const SealInput = forwardRef<HTMLInputElement, SealInputProps>(
  (
    {
      id,
      label,
      caption,
      value,
      onChange,
      onAdvance,
      duplicate = false,
      warning = false,
      disabled = false,
      children,
    },
    ref,
  ) => (
    <div className="space-y-1" data-seal-field={id}>
      <label htmlFor={id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
        {caption !== undefined && (
          <span className="text-xs text-slate-500 dark:text-slate-400">{caption}</span>
        )}
      </label>
      <input
        ref={ref}
        id={id}
        type="text"
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        {...(duplicate ? { 'data-duplicate': 'true' } : {})}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (sealKeyAction(e) !== 'next') return;
          e.preventDefault();
          onAdvance();
        }}
        className={cn(
          'w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm text-slate-800 placeholder:text-slate-400',
          'disabled:cursor-not-allowed disabled:bg-slate-50 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800',
          duplicate || warning
            ? 'border-orange-500 ring-1 ring-orange-400 focus:border-orange-500'
            : value.trim() !== ''
              ? 'border-emerald-500 focus:border-emerald-600'
              : 'border-slate-300 focus:border-brand-400 dark:border-slate-700',
        )}
      />
      <div aria-live="polite" className="space-y-0.5 text-xs text-orange-700 dark:text-orange-300">
        {children}
      </div>
    </div>
  ),
);
SealInput.displayName = 'SealInput';
