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
import { useEffect, useRef, useState } from 'react';
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
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../../shared/lib/errors';
import { formatNumber, localized } from '../../../../shared/lib/format';
import { stepLegacyImport, undoLegacySource } from '../../api/settings-api';
import { useAtmLegacySources, useRestaleAtmLegacySources } from '../../api/settings-queries';
import { ConfirmActionDialog } from '../ReplenishmentDialogs';
import { LegacyHistoryDialog, type LegacyImportSubject } from './LegacyHistoryDialog';

/** The key the page and the import answer to (the route guard's, `routes.tsx`). */
const MANAGE = 'atmSettings.manage';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A loop in progress on one source's row. */
export interface LegacyBusy {
  source: AtmLegacySource;
  kind: 'run' | 'undo';
  done: number;
  total: number;
}

/** Legacy rows a run has read so far, of all it will read — the bar's numbers. */
export const legacyRunProgress = (run: AtmLegacyImportRunDto): { done: number; total: number } => ({
  done: run.replenishment.read + run.maintenance.read,
  total: run.totals.replenishment + run.totals.maintenance,
});

/** Whole percent, 0–100; an empty total is done. */
export const percentOf = (done: number, total: number): number =>
  total <= 0 ? 100 : Math.min(100, Math.floor((done / total) * 100));

/** What a source's row says under its name: its last run, and the copies it holds now. */
export const legacySourceStatus = (
  entry: AtmLegacySourceDto,
  t: Translate,
  locale: Locale,
): string => {
  const n = (value: number): string => formatNumber(value, locale);
  if (entry.branchId === null) return t('atm.settings.legacy.noBranch');
  const run = entry.lastRun;
  const last =
    run === null
      ? t('atm.settings.legacy.never')
      : run.state === 'running'
        ? t('atm.settings.legacy.paused', {
            done: n(legacyRunProgress(run).done),
            total: n(legacyRunProgress(run).total),
          })
        : t(`atm.settings.legacy.last.${run.state}`);
  return entry.copiedRows > 0
    ? `${last} — ${t('atm.settings.legacy.copied', { count: n(entry.copiedRows) })}`
    : last;
};

/** The success toast's summary: rows copied, and rows already there, per kind. */
export const legacyRunSummary = (run: AtmLegacyImportRunDto, t: Translate, locale: Locale) =>
  t('atm.settings.legacy.summary', {
    replenishment: formatNumber(run.replenishment.written, locale),
    maintenance: formatNumber(run.maintenance.written, locale),
    existing: formatNumber(run.replenishment.existing + run.maintenance.existing, locale),
  });

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
  // A loop stops when the card goes: the page closed pauses a run, as the server expects.
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const branchOf = (name: LocalizedString | null): string =>
    name === null ? t('atm.settings.unknownBranch') : localized(name, locale);

  const runLoop = async (first: AtmLegacyImportRunDto): Promise<void> => {
    let run = first;
    setBusy({ source: run.source, kind: 'run', ...legacyRunProgress(run) });
    try {
      while (run.state === 'running' && alive.current) {
        run = await stepLegacyImport(run.id);
        setBusy({ source: run.source, kind: 'run', ...legacyRunProgress(run) });
      }
      if (run.state === 'done') {
        toast.success(
          t('atm.settings.legacy.done', { source: run.source }),
          legacyRunSummary(run, t, locale),
        );
      }
    } catch (error) {
      toast.error(errorMessage(error, locale));
    } finally {
      if (alive.current) setBusy(null);
      restale();
    }
  };

  const undoLoop = async (entry: AtmLegacySourceDto): Promise<void> => {
    const total = entry.copiedRows;
    setBusy({ source: entry.source, kind: 'undo', done: 0, total });
    try {
      let remaining = total;
      while (remaining > 0 && alive.current) {
        const result = await undoLegacySource(entry.source);
        remaining = result.remaining;
        setBusy({ source: entry.source, kind: 'undo', done: total - remaining, total });
        if (result.removed === 0 && remaining > 0) break;
      }
      if (remaining === 0) {
        toast.success(t('atm.settings.legacy.undone', { source: entry.source }));
      }
    } catch (error) {
      toast.error(errorMessage(error, locale));
    } finally {
      if (alive.current) setBusy(null);
      restale();
    }
  };

  const rows = sources.data ?? [];
  return (
    <Card>
      <CardHeader
        title={t('atm.settings.legacy.cardTitle')}
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
              const running = entry.lastRun?.state === 'running';
              return (
                <li
                  key={entry.source}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
                  data-legacy-source={entry.source}
                >
                  <span className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">
                    {t('atm.settings.legacy.row', { source: entry.source, branch })}
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {legacySourceStatus(entry, t, locale)}
                    </span>
                  </span>
                  {may && running && entry.lastRun !== null && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      data-legacy-action="resume"
                      onClick={() => {
                        if (entry.lastRun !== null) void runLoop(entry.lastRun);
                      }}
                    >
                      {t('atm.settings.legacy.resume')}
                    </Button>
                  )}
                  {may && !running && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null || entry.branchId === null}
                      data-legacy-action="preview"
                      onClick={() => setOpening({ source: entry.source, branch })}
                    >
                      {t('atm.settings.legacy.preview')}
                    </Button>
                  )}
                  {may && !running && entry.copiedRows > 0 && (
                    <Button
                      variant="ghost-danger"
                      size="sm"
                      disabled={busy !== null}
                      data-legacy-action="undo"
                      onClick={() => setUndoing(entry)}
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
        onStarted={(run) => {
          restale();
          void runLoop(run);
        }}
      />
      <ConfirmActionDialog
        open={undoing !== null}
        title={t('atm.settings.legacy.undoTitle', { source: undoing?.source ?? '' })}
        body={t('atm.settings.legacy.undoBody', {
          count: formatNumber(undoing?.copiedRows ?? 0, locale),
          source: undoing?.source ?? '',
        })}
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
