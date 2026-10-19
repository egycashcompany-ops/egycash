// Reveal the safe-door combination (POST /atm/register/entries/:id/reveal) — the ONE place the
// value of column AO is ever on screen (D3, DEC-18, ADR-034).
//
// The reveal is a deliberate act, so it is a button inside a dialog that says first what it does:
// every press writes an audit row with the reader's name and the time, whether or not a value is
// recorded. The value then shows for thirty seconds and is gone.
//
// Where the value lives, and for how long, is the whole design:
//   · only in the reveal MUTATION's result — never copied into component state, never into the
//     query cache, never logged;
//   · the mutation is created with `gcTime: 0` (register-queries.ts), so TanStack does not keep
//     the result for its default five minutes once nothing observes it;
//   · when the thirty seconds run out, when the dialog closes, and when the screen unmounts, the
//     mutation is `reset()` — which drops the result there and then rather than at the next GC.
// Copying puts it on the clipboard because the reader asked; nothing here does that on its own.
import { useEffect, useRef, useState } from 'react';
import { type AtmRegisterEntryDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { ClipboardIcon, EyeIcon, ShieldIcon } from '../../../../shared/ui/icons';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useRevealRegisterCombination } from '../../api/register-queries';
import { FormError, registerErrorText } from './EntryFormSections';

/** How long a revealed combination stays on screen (DEC-18). */
export const REVEAL_SECONDS = 30;

export const RevealCombinationDialog = ({
  entry,
  onClose,
}: {
  entry: AtmRegisterEntryDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const reveal = useRevealRegisterCombination();
  const [secondsLeft, setSecondsLeft] = useState(REVEAL_SECONDS);

  // `reset` is the observer's own bound method — stable — but read through a ref so the cleanup
  // below always calls the current one.
  const resetRef = useRef(reveal.reset);
  resetRef.current = reveal.reset;

  // The countdown: from the moment a value arrives, thirty seconds — then it is cleared.
  const revealedAt = reveal.isSuccess ? reveal.submittedAt : null;
  useEffect(() => {
    if (revealedAt === null) return undefined;
    setSecondsLeft(REVEAL_SECONDS);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const left = REVEAL_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        window.clearInterval(timer);
        resetRef.current();
      } else {
        setSecondsLeft(left);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [revealedAt]);

  // Leaving the screen with the value up clears it as closing does.
  useEffect(() => () => resetRef.current(), []);

  const close = (): void => {
    reveal.reset();
    onClose();
  };

  const copy = (value: string): void => {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      toast.error(t('atm.common.actionFailed'));
      return;
    }
    clipboard
      .writeText(value)
      .then(() => toast.success(t('common.copyId.done')))
      .catch(() => toast.error(t('atm.common.actionFailed')));
  };

  const shown = reveal.isSuccess ? reveal.data : null;

  return (
    <Dialog
      open
      onClose={close}
      title={t('atm.register.reveal.title')}
      size="sm"
      footer={
        shown === null ? (
          <>
            <Button variant="ghost" onClick={close}>
              {t('atm.common.cancel')}
            </Button>
            <Button
              loading={reveal.isPending}
              leftIcon={<EyeIcon className="h-4 w-4" />}
              onClick={() => reveal.mutate(entry.id)}
            >
              {t('atm.register.reveal.confirm')}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={close}>
            {t('common.close')}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
          <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
          {t('atm.register.reveal.body')}
        </p>
        <FormError message={reveal.isError ? registerErrorText(reveal.error, t, locale) : null} />
        {shown !== null &&
          (shown.safeCombination === null ? (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {t('atm.register.reveal.none')}
            </p>
          ) : (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center dark:border-slate-700 dark:bg-slate-800">
              <output
                dir="ltr"
                className="block select-all font-mono text-3xl font-semibold tracking-widest text-slate-900 dark:text-white"
              >
                {shown.safeCombination}
              </output>
              <div className="flex items-center justify-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span data-reveal-countdown={secondsLeft}>
                  {t('atm.register.reveal.hidesIn', {
                    seconds: formatNumber(secondsLeft, locale),
                  })}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<ClipboardIcon className="h-3.5 w-3.5" />}
                  onClick={() => copy(shown.safeCombination ?? '')}
                >
                  {t('atm.register.reveal.copy')}
                </Button>
              </div>
            </div>
          ))}
      </div>
    </Dialog>
  );
};
