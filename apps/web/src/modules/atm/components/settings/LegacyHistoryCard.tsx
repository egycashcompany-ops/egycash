// «استيراد السجل القديم» — the old system's replenishments and maintenances, copied into the branch
// each legacy deployment was. The owner (2026-11-25): «تقدر تشوفهم أنت من Mongo مباشرة جوا
// maintenance و replenishment — وللأفرع كلها مش بس المهندسين وأكتوبر .. ماعدا أسيوط».
// Design: docs/12-planning/atm-legacy-history-import.md.
//
// One row per source, with its branch — the one its code names, never chosen here. «معاينة» opens
// the preview, which is also the confirmation (LegacyHistoryDialog). A run and an undo are LOOPS
// this card drives — one step, or one batch, per request — so closing the page pauses a run:
// «متابعة» on its row carries it on, and the server ends one left 30 minutes. Nothing is changed in
// the old system; nothing already in ECMS is changed by a run.
import { useState } from 'react';
import {
  type AtmLegacyImportRunDto,
  type AtmLegacySource,
  type AtmLegacySourceDto,
  type Locale,
  type LocalizedString,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { EyeIcon, PlayIcon, UndoIcon } from '../../../../shared/ui/icons';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatNumber, localized } from '../../../../shared/lib/format';
import { stepLegacyImport, undoLegacySource } from '../../api/settings-api';
import { useMountedRef } from '../../lib/useMountedRef';
import { useAtmLegacySources, useRestaleAtmLegacySources } from '../../api/settings-queries';
import { ConfirmActionDialog } from '../ReplenishmentDialogs';
import { LegacyHistoryDialog, type LegacyImportSubject } from './LegacyHistoryDialog';
import {
  isRunEnded,
  isStepBusy,
  legacyErrorText,
  legacyRunProgress,
  legacyRunSummary,
  legacySourceStatus,
  percentOf,
} from './legacy-history-view';

/** The key the page and the import answer to (the route guard's, `routes.tsx`). */
const MANAGE = 'atmSettings.manage';

/**
 * A step another request holds (a second tab, a step still finishing) is tried again after a
 * pause — the server's lease is two minutes, so this outwaits one left by a request that died.
 */
const BUSY_PAUSE_MS = 3_000;
const BUSY_TRIES = 50;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A loop in progress on one source's row. */
export interface LegacyBusy {
  source: AtmLegacySource;
  kind: 'run' | 'undo';
  done: number;
  total: number;
}

const Progress = ({ busy }: { busy: LegacyBusy }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const pct = percentOf(busy.done, busy.total);
  const label = t(`atm.settings.legacy.progress.${busy.kind}`, {
    done: formatNumber(busy.done, locale),
    total: formatNumber(busy.total, locale),
  });
  return (
    <div className="flex basis-full flex-col gap-1.5" data-legacy-progress={busy.source}>
      <div className="flex justify-between text-[13px] text-slate-700 dark:text-slate-200">
        <span>{label}</span>
        <span className="text-slate-500 dark:text-slate-400">
          {new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { style: 'percent' }).format(
            pct / 100,
          )}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={label}
        className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      >
        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${String(pct)}%` }} />
      </div>
    </div>
  );
};

export const LegacyHistoryCard = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const may = can(MANAGE);
  const sources = useAtmLegacySources(may);
  const restale = useRestaleAtmLegacySources();
  const [opening, setOpening] = useState<LegacyImportSubject | null>(null);
  const [undoing, setUndoing] = useState<AtmLegacySourceDto | null>(null);
  const [busy, setBusy] = useState<LegacyBusy | null>(null);
  /** A source whose «تراجع» is reading the server's count — its row waits for the answer. */
  const [checking, setChecking] = useState<AtmLegacySource | null>(null);
  /**
   * Runs this window drove and stopped (a step failed): their last claim makes them `active` for
   * two more minutes on the server's clock, but no window drives them — «متابعة» is offered.
   */
  const [stoppedHere, setStoppedHere] = useState<ReadonlySet<string>>(new Set());
  // A loop stops when the card goes: the page closed pauses a run, as the server expects. The
  // project's hook, so StrictMode's second mount sets it again (useMountedRef).
  const alive = useMountedRef();

  const branchOf = (name: LocalizedString | null): string =>
    name === null ? t('atm.settings.unknownBranch') : localized(name, locale);

  /**
   * One step; a busy run is waited for and tried again, never shown as a failure. Null when the
   * card went away during a pause — the page closed pauses the run, so no further step is sent.
   */
  const stepOf = async (runId: string): Promise<AtmLegacyImportRunDto | null> => {
    for (let tries = 1; ; tries += 1) {
      try {
        return await stepLegacyImport(runId);
      } catch (error) {
        if (!isStepBusy(error) || tries >= BUSY_TRIES) throw error;
        await pause(BUSY_PAUSE_MS);
        if (!alive.current) return null;
      }
    }
  };

  const runLoop = async (first: AtmLegacyImportRunDto): Promise<void> => {
    let run = first;
    setBusy({ source: run.source, kind: 'run', ...legacyRunProgress(run) });
    try {
      while (run.state === 'running' && alive.current) {
        const next = await stepOf(run.id);
        if (next === null) return;
        run = next;
        if (alive.current) setBusy({ source: run.source, kind: 'run', ...legacyRunProgress(run) });
      }
      if (run.state === 'done') {
        toast.success(
          t('atm.settings.legacy.done', { source: run.source }),
          legacyRunSummary(run, t, locale),
        );
      }
    } catch (error) {
      // A step that fails after the card closed is not news on whatever page the reader is on;
      // nor is a run another window finished meanwhile — the card's re-read shows how it ended.
      if (alive.current && !isRunEnded(error)) toast.error(legacyErrorText(error, t, locale));
      if (alive.current) setStoppedHere((ids) => new Set(ids).add(run.id));
    } finally {
      if (alive.current) setBusy(null);
      restale();
    }
  };

  const undoLoop = async (entry: AtmLegacySourceDto): Promise<void> => {
    // The server removes every copy the source holds now — more than the card read, if another
    // window imported since — so the total grows to what the batches report (LinkResolutionCard).
    let total = entry.copiedRows;
    let done = 0;
    setBusy({ source: entry.source, kind: 'undo', done, total });
    try {
      let remaining = total;
      while (remaining > 0 && alive.current) {
        const result = await undoLegacySource(entry.source);
        remaining = result.remaining;
        done += result.removed;
        total = Math.max(total, done + remaining);
        if (alive.current) setBusy({ source: entry.source, kind: 'undo', done, total });
        // A batch that removed nothing while rows remain would loop for ever: stop and say so.
        if (result.removed === 0 && remaining > 0) break;
      }
      if (remaining === 0) {
        toast.success(t('atm.settings.legacy.undone', { source: entry.source }));
      } else if (alive.current) {
        toast.warning(
          t('atm.settings.legacy.undoStopped', {
            source: entry.source,
            count: formatNumber(remaining, locale),
          }),
        );
      }
    } catch (error) {
      if (alive.current) toast.error(legacyErrorText(error, t, locale));
    } finally {
      if (alive.current) setBusy(null);
      restale();
    }
  };

  /**
   * «تراجع» asks with the count the server holds NOW: a tab left open may have read the source
   * before another window imported again (review finding, 2026-11-25).
   */
  const confirmUndo = async (entry: AtmLegacySourceDto): Promise<void> => {
    setChecking(entry.source);
    try {
      const fresh = (await sources.refetch()).data?.find((row) => row.source === entry.source);
      // Asked only if the source still offers it: copies held, and no run it would refuse for.
      const run = fresh?.lastRun?.state === 'running' ? fresh.lastRun : null;
      if (
        alive.current &&
        fresh !== undefined &&
        fresh.copiedRows > 0 &&
        (run === null || run.stale)
      ) {
        setUndoing(fresh);
      }
    } finally {
      if (alive.current) setChecking(null);
    }
  };

  const rows = sources.data ?? [];
  return (
    <Card>
      <CardHeader
        title={t('atm.settings.legacy.title')}
        description={t('atm.settings.legacy.hint')}
      />
      <CardBody className="space-y-4">
        {sources.isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : sources.isError ? (
          <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
        ) : (
          <ul className="space-y-2">
            {rows.map((entry) => {
              const branch = branchOf(entry.branchName);
              const mine = busy?.source === entry.source ? busy : null;
              const run = entry.lastRun?.state === 'running' ? entry.lastRun : null;
              // Driven by a window now (this one, or another): nothing else is offered.
              const driven = mine !== null || (run?.active === true && !stoppedHere.has(run.id));
              // While any row's «تراجع» reads its count, or a dialog is open, nothing new starts.
              const held = busy !== null || checking !== null || undoing !== null;
              // Paused: carried on. Stale (left 30 minutes): also undone or started over — the
              // server ends it at either.
              const offerNew = run === null || run.stale;
              const names = { source: entry.source };
              return (
                <li
                  key={entry.source}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
                  data-legacy-source={entry.source}
                >
                  <span className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">
                    {t('atm.settings.legacy.row', { source: entry.source, branch })}
                    {/* This window's own loop shows its progress below instead. */}
                    {mine === null && (
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {legacySourceStatus(
                          entry,
                          t,
                          locale,
                          run !== null && stoppedHere.has(run.id),
                        )}
                      </span>
                    )}
                  </span>
                  {may && run !== null && (
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<PlayIcon className="h-4 w-4" />}
                      disabled={held || driven}
                      aria-label={t('atm.settings.legacy.resumeFor', names)}
                      data-legacy-action="resume"
                      onClick={() => void runLoop(run)}
                    >
                      {t('atm.settings.legacy.resume')}
                    </Button>
                  )}
                  {may && offerNew && (
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<EyeIcon className="h-4 w-4" />}
                      disabled={held || entry.branchId === null}
                      aria-label={t('atm.settings.legacy.previewFor', names)}
                      data-legacy-action="preview"
                      onClick={() => setOpening({ source: entry.source, branch })}
                    >
                      {t('atm.settings.legacy.preview')}
                    </Button>
                  )}
                  {may && offerNew && entry.copiedRows > 0 && (
                    <Button
                      variant="ghost-danger"
                      size="sm"
                      leftIcon={<UndoIcon className="h-4 w-4" />}
                      disabled={held}
                      loading={checking === entry.source}
                      aria-label={t('atm.settings.legacy.undoFor', names)}
                      data-legacy-action="undo"
                      onClick={() => void confirmUndo(entry)}
                    >
                      {t('atm.settings.legacy.undo')}
                    </Button>
                  )}
                  {mine !== null && <Progress busy={mine} />}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      <LegacyHistoryDialog
        subject={may ? opening : null}
        onClose={() => setOpening(null)}
        onStarted={(run) => void runLoop(run)}
      />
      <ConfirmActionDialog
        open={undoing !== null}
        title={t('atm.settings.legacy.undoTitle', { source: undoing?.source ?? '' })}
        body={[
          t('atm.settings.legacy.undoBody', {
            count: formatNumber(undoing?.copiedRows ?? 0, locale),
            source: undoing?.source ?? '',
          }),
          // Copies changed in ECMS since — closed again, edited, reopened — go too: said aloud.
          (undoing?.changedRows ?? 0) > 0
            ? t('atm.settings.legacy.undoChanged', {
                count: formatNumber(undoing?.changedRows ?? 0, locale),
              })
            : '',
        ]
          .filter((line) => line !== '')
          .join(' ')}
        confirmLabel={t('atm.settings.legacy.undo')}
        danger
        busy={busy?.kind === 'undo'}
        onConfirm={() => {
          const entry = undoing;
          setUndoing(null);
          if (entry !== null) void undoLoop(entry);
        }}
        onClose={() => setUndoing(null)}
      />
    </Card>
  );
};
