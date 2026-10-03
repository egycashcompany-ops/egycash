// Pressing Save with a required value missing — «يجيلوا مسدج انه فى كذا وكذا وكذا المفروض يدخلهم
// والخانات نفسها تتقلب باللون الاحمر».
//
// Save stays ENABLED. A disabled button swallowed the click and said nothing, which is exactly what
// the owner photographed: a form that would not save and no word of why. Now the press is the
// question, and the answer is two things at once:
//
//   • a banner at the top of the form naming every missing value (`MissingFieldsBanner`);
//   • each of those values' `Field` marked `missing` — its label and its box red, «حقل مطلوب» under
//     it (`Field` in `form.tsx`).
//
// Both are read from the values as they are NOW, so the moment a box is filled its red goes and its
// name leaves the banner. Nothing is shown before the first press: a form that opens covered in red
// accuses the user of a mistake they have not made yet.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../platform/localization/useT';
import { cn } from '../lib/cn';

export interface RequiredField {
  /** Which `Field` this is — what `isMissing` is asked with. */
  key: string;
  /** What the banner calls it: the field's own label. */
  label: string;
  /** Filled in, and valid enough to save. */
  ok: boolean;
}

/** The fields a save cannot go without, that it is going without. */
export const missingFields = (fields: readonly RequiredField[]): RequiredField[] =>
  fields.filter((field) => !field.ok);

export interface RequiredFields {
  /** What the banner lists — empty until Save has been pressed once. */
  missing: RequiredField[];
  /** Should this `Field` read as missing right now? */
  isMissing: (key: string) => boolean;
  /** How many presses were refused — the banner scrolls itself into view on each one. */
  attempt: number;
  /**
   * Wrap a save with it. With everything in, the save runs; with something missing, the form is
   * marked instead and nothing is sent.
   */
  guard: (save: () => unknown) => () => void;
}

/**
 * `resetWhen` clears the marks — the dialog's `open`, or the row it edits — so a form that is
 * opened again starts clean rather than red from the last time.
 */
export const useRequiredFields = (
  fields: readonly RequiredField[],
  resetWhen?: unknown,
): RequiredFields => {
  const [tried, setTried] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setTried(false);
    setAttempt(0);
  }, [resetWhen]);
  const missing = tried ? missingFields(fields) : [];
  const keys = new Set(missing.map((field) => field.key));
  return {
    missing,
    isMissing: (key) => keys.has(key),
    attempt,
    guard: (save) => () => {
      if (missingFields(fields).length > 0) {
        setTried(true);
        setAttempt((n) => n + 1);
        return;
      }
      void save();
    },
  };
};

/** «⚠ لم يتم الحفظ. أدخل البيانات المطلوبة: كود السيارة، رقم اللوحة.» — or nothing. */
export const MissingFieldsBanner = ({
  missing,
  attempt = 0,
  className,
}: {
  missing: readonly RequiredField[];
  /**
   * `useRequiredFields`'s count of refused presses. A long form is pressed from the bottom, where
   * its Save is, with the banner scrolled out of sight above: on every refused press it brings
   * itself into view, or the press would still look like nothing happened.
   */
  attempt?: number;
  /** Where it sits in the form's own layout — a grid form gives it the whole row. */
  className?: string;
}): JSX.Element | null => {
  const t = useT();
  const own = useRef<HTMLDivElement | null>(null);
  const shown = missing.length > 0;
  useEffect(() => {
    if (shown && attempt > 0) own.current?.scrollIntoView?.({ block: 'nearest' });
  }, [attempt, shown]);
  if (!shown) return null;
  const fields = missing.map((field) => field.label).join(t('common.validation.separator'));
  return (
    <div
      ref={own}
      role="alert"
      data-missing-fields="true"
      className={cn(
        'rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800',
        'dark:border-red-800 dark:bg-red-950/60 dark:text-red-200',
        className,
      )}
    >
      ⚠ <strong>{t('common.validation.notSaved')}</strong>{' '}
      {t('common.validation.enterRequired', { fields })}
    </div>
  );
};

/**
 * Set by a `Field` marked `missing`, read by the control inside it — so a missing field turns its
 * own box red without every caller passing `error` to the control as well.
 */
const FieldMissing = createContext(false);

export const FieldMissingProvider = ({
  missing,
  children,
}: {
  missing: boolean;
  children: ReactNode;
}): JSX.Element => <FieldMissing.Provider value={missing}>{children}</FieldMissing.Provider>;

/** Is the `Field` around this control marked missing? `false` outside any `Field`. */
export const useFieldMissing = (): boolean => useContext(FieldMissing);
