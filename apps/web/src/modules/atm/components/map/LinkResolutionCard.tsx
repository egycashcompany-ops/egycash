// «تحويل الروابط المختصرة تلقائيًا» (docs/12-planning/atm-map-zones.md D-M4, DM-46, §8.8, §8.10):
// exactly the approved mockup's card — the body, «بدء التحويل» and «n من m». No stop button and no
// retry: the server opens each short link once.
//
// THE LOOP IS THE BROWSER'S, THE STATE IS THE SERVER'S. Each call opens up to twenty links; the next
// starts at once while links remain and nothing stopped the run (`resolveLoopShouldContinue`).
// Another person's run (`busy`), Google refusing (`rateLimited`), no answer at all (`unreachable`),
// a failed call or leaving the page ends it. The pending links stay pending on the server, so
// «بدء التحويل» resumes — after the idle logout too.
import { useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { errorMessage } from '../../../../shared/lib/errors';
import { formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useResolveLinks } from '../../api/map-queries';
import { useMountedRef } from '../../lib/useMountedRef';
import {
  resolveLoopEndMessage,
  resolveLoopShouldContinue,
  type FeedbackTone,
} from '../../lib/unlocated-view';

const TONE: Record<FeedbackTone, string> = {
  success: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  error: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200',
};

export const LinkResolutionCard = ({
  branchId,
  pending,
  locale,
}: {
  branchId: string | null;
  /** Short links waiting on the server (the summary's `shortLinksPending`). */
  pending: number | undefined;
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  const resolve = useResolveLinks();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: FeedbackTone } | null>(null);
  // Leaving the page ends the loop (§8.10); true again after StrictMode's development remount.
  const alive = useMountedRef();

  const start = async (): Promise<void> => {
    if (running) return;
    setRunning(true);
    setMessage(null);
    const total = pending ?? 0;
    let done = 0;
    let resolved = 0;
    let failed = 0;
    setProgress({ done, total });
    try {
      for (;;) {
        const result = await resolve.mutateAsync(branchId === null ? {} : { branchId });
        // Leaving the page ends the loop (§8.10).
        if (!alive.current) return;
        done += result.attempted;
        resolved += result.resolved;
        failed += result.failed;
        setProgress({ done, total: Math.max(total, done + result.remaining) });
        if (!resolveLoopShouldContinue(result)) {
          const end = resolveLoopEndMessage(result, { resolved, failed, total: done });
          if (end !== null) setMessage({ text: t(end.key, end.params), tone: end.tone });
          break;
        }
      }
    } catch (error) {
      if (alive.current) toast.error(errorMessage(error, locale));
    } finally {
      if (alive.current) setRunning(false);
    }
  };

  const shown = progress ?? { done: 0, total: pending ?? 0 };
  return (
    <section
      data-link-card="true"
      className="flex flex-col gap-2 rounded-[10px] border border-dashed border-brand-200 bg-[#f8faff] p-3 dark:border-brand-800 dark:bg-brand-950/40"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
        {t('atm.map.links.title')}
      </h2>
      <p className="text-xs leading-[1.7] text-slate-600 dark:text-slate-300">
        {t('atm.map.links.body')}
      </p>
      <div className="flex items-center gap-2.5">
        <Button
          size="sm"
          loading={running}
          disabled={(pending ?? 0) === 0 && !running}
          onClick={() => void start()}
        >
          {t('atm.map.links.start')}
        </Button>
        <span aria-live="polite" className="text-xs text-slate-600 dark:text-slate-300">
          {t('atm.map.links.progress', {
            done: formatNumber(shown.done, locale),
            total: formatNumber(shown.total, locale),
          })}
        </span>
      </div>
      {message !== null && (
        <p role="status" className={cn('rounded-lg px-2.5 py-2 text-xs', TONE[message.tone])}>
          {message.text}
        </p>
      )}
    </section>
  );
};
