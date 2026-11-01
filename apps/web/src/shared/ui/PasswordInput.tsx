// A password field with a reveal control, in one place.
//
// Nine password fields shipped across four screens, each a bare `<Input type="password">`, and
// adding an eye to each would have been nine chances for the accessible name, the RTL placement or
// the button's `type` to differ. This wraps the shared `Input` rather than changing it: everything
// else about the field — its ring, its dark palette, its `disabled` styling — stays whatever
// `Input` says it is.
//
// **The toggle changes the input's TYPE and nothing else.** Not its value, not its `required`, not
// its `name`, and it never submits: `type="button"` is explicit, because a `<button>` inside a
// `<form>` defaults to `submit` and would send the form on the first click — which on the login
// screen would attempt a sign-in with a half-typed password.
//
// The field stays `dir="ltr"` (a password is not prose), so the eye goes on the visual right in
// both locales, and the WRAPPER is `dir="ltr"` too. The button's `end-0` and the input's `pe-10` are
// both logical, and each resolves against its own element's direction: with only the input
// left-to-right, Arabic put the room for the button on the right and the button itself on the left
// (the page's end), on top of the characters being typed — «العين بتيجي فوق الباسورد وأنا بكتبه».
// One direction for the whole control keeps the two on the same side.
import { forwardRef, useId, useState, type InputHTMLAttributes } from 'react';
import { useT } from '../../platform/localization/useT';
import { cn } from '../lib/cn';
import { Input } from './form';
import { EyeIcon, EyeOffIcon } from './icons';

export interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  error?: boolean;
  /** Wired by the caller when the field is described by requirements or an error message. */
  'aria-describedby'?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ error = false, className, disabled, ...rest }, ref) => {
    const t = useT();
    const [revealed, setRevealed] = useState(false);
    const fallbackId = useId();
    const inputId = rest.id ?? fallbackId;
    const label = t(revealed ? 'common.password.hide' : 'common.password.show');

    return (
      <div className="relative" dir="ltr">
        <Input
          {...rest}
          id={inputId}
          ref={ref}
          type={revealed ? 'text' : 'password'}
          dir="ltr"
          error={error}
          disabled={disabled}
          // Room for the button, on the logical end so Arabic needs no second rule.
          className={cn('pe-10', className)}
        />
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          disabled={disabled}
          aria-label={label}
          aria-pressed={revealed}
          aria-controls={inputId}
          title={label}
          className="absolute inset-y-0 end-0 flex items-center pe-3 text-slate-400 transition-colors hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-slate-200"
        >
          {revealed ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
