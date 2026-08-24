// The switch that turns Web Push on for THIS browser.
//
// Per browser, not per account, and the copy says so — this is the one preference on the account
// page that does not follow the person to another device, because a push has to be addressed to a
// specific installation. Somebody who turns it on at work and then opens ECMS at home should not
// be told it is already on when their laptop will never buzz.
//
// Four of its five states are dead ends the person can do nothing about from here, and each says
// what would change it rather than showing a switch that does not work:
//   • unsupported — the browser has no Push API (on iOS, a tab that has not been installed);
//   • unconfigured — this deployment has no VAPID pair, so there is nothing to switch on;
//   • denied — the browser refused, and only site settings can undo that, never a button here.
import { useEffect, useState } from 'react';
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { toast } from '../../shared/ui/toast/toast-store';
import { Spinner } from '../../shared/ui';
import { disablePush, enablePush, readPushState, type PushState } from './push-registration';

export const PushToggle = (): JSX.Element => {
  const t = useT();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void readPushState()
      .then((next) => {
        if (live) setState(next);
      })
      .catch(() => {
        // Reading the state is a best-effort question about this browser; a failure here should
        // leave the section quiet rather than raise an error over a preference.
        if (live) setState({ status: 'unsupported' });
      });
    return () => {
      live = false;
    };
  }, []);

  if (state === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Spinner className="h-4 w-4" />
        {t('common.loading')}
      </div>
    );
  }

  const blocked = state.status === 'unsupported' || state.status === 'unconfigured' || state.status === 'denied';

  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = state.status === 'on' ? await disablePush() : await enablePush();
      setState(next);
      if (next.status === 'on') toast.success(t('account.push.enabled'));
      else if (next.status === 'denied') toast.warning(t('account.push.deniedToast'));
      else if (next.status === 'off') toast.info(t('account.push.disabled'));
    } catch {
      toast.error(t('account.push.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {t('account.push.legend')}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('account.push.hint')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.status === 'on'}
          aria-label={t('account.push.legend')}
          disabled={blocked || busy}
          onClick={() => void toggle()}
          className={cn(
            'relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900',
            'disabled:cursor-not-allowed disabled:opacity-50',
            state.status === 'on' ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start]',
              state.status === 'on' ? 'start-[1.375rem]' : 'start-0.5',
            )}
          />
        </button>
      </div>

      {blocked && (
        <p
          className={cn(
            'rounded-lg border px-3 py-2 text-xs',
            'border-amber-300 bg-amber-50 text-amber-900',
            'dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
          )}
        >
          {t(`account.push.${state.status}`)}
        </p>
      )}
    </div>
  );
};
