// A money field that reads the way money reads: type 1000 and the field shows 1,000.
//
// TWO VALUES, ONE FIELD. What the user reads is grouped; what `onChange` hands back — and what the
// form therefore submits — is the plain `1000` every call site already stored. No caller's submit
// path changes, because the value it holds does not.
//
// This CANNOT be `<input type="number">`. That control's value must parse as a number, so a comma
// blanks it: the browser reports `value === ''` and the digits are gone. Hence `type="text"` with
// `inputMode="decimal"`, which still brings up the numeric keypad on a phone. The constraints the
// number input carried are not lost — `sanitizeAmount` refuses a minus sign (every money field
// here is `min={0}`) and caps the decimals at what `MoneyAmountSchema` records.
//
// The component holds no rules. Grouping, sanitising, the caret and the separator-delete all live
// in `shared/lib/money-input.ts`, which is React-free and covered by the node suite.
import { forwardRef, useRef, type InputHTMLAttributes } from 'react';
import {
  caretAfterGrouping,
  groupAmount,
  sanitizeAmount,
  separatorDelete,
  typedBeforeCaret,
} from '../lib/money-input';
import { Input } from './form';

export interface MoneyInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** The canonical amount — `''`, `'1000'`, `'1000.5'`. Never grouped. */
  value: string;
  /** Receives the canonical amount, so the caller stores exactly what it stored before. */
  onChange: (value: string) => void;
  error?: boolean;
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, ...rest }, forwarded) => {
    const own = useRef<HTMLInputElement | null>(null);

    // Write the grouped text and the caret onto the element NOW, then report the canonical value
    // upward. Doing both in the same tick is what keeps the caret still: React re-renders with the
    // identical string, sees no change to make, and leaves the selection alone. Deferring the caret
    // to an effect would let it sit at the end of the line for a frame on every keystroke.
    const commit = (raw: string, caret: number): void => {
      const canonical = sanitizeAmount(raw);
      const shown = groupAmount(canonical);
      const element = own.current;
      if (element !== null) {
        const at = caretAfterGrouping(shown, typedBeforeCaret(raw, caret));
        element.value = shown;
        element.setSelectionRange(at, at);
      }
      onChange(canonical);
    };

    return (
      <Input
        {...rest}
        ref={(node) => {
          own.current = node;
          if (typeof forwarded === 'function') forwarded(node);
          else if (forwarded !== null) forwarded.current = node;
        }}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        // An amount reads left-to-right in either language: the digits ascend leftward and the
        // decimal point trails. Inside an RTL form this is the same `dir="ltr"` the number inputs
        // it replaces already carried.
        dir="ltr"
        value={groupAmount(value)}
        onChange={(event) => {
          const element = event.currentTarget;
          commit(element.value, element.selectionStart ?? element.value.length);
        }}
        onKeyDown={(event) => {
          const element = event.currentTarget;
          const { selectionStart, selectionEnd } = element;
          // A range selection deletes exactly what is highlighted — nothing to intervene in.
          if (selectionStart === null || selectionStart !== selectionEnd) return;
          if (event.key !== 'Backspace' && event.key !== 'Delete') return;
          const edit = separatorDelete(element.value, selectionStart, event.key);
          if (edit === null) return;
          event.preventDefault();
          commit(edit.raw, edit.caret);
        }}
      />
    );
  },
);
MoneyInput.displayName = 'MoneyInput';
