// «استيراد السجل القديم» — one legacy source's preview, and the start of its import
// (docs/12-planning/atm-legacy-history-import.md). The dialog IS the confirmation, as the move's
// is (MoveBranchDataDialog): it opens on the server's PREVIEW — the rows the run would copy, each
// row it would leave out under the first rule it fails, how the old system wrote each kind's
// times — and «استيراد» stays held back until the preview allows it. The run itself steps in the
// card, which shows its progress.
//
// The cut is a MOMENT: the branch's first own row in ECMS, suggested by the server. A legacy row
// closed at or after it is the branch's own work, entered in ECMS, and is not copied.
import { useEffect, useState } from 'react';
import {
  ATM_LEGACY_KINDS,
  ATM_LEGACY_SKIP_REASONS,
  type AtmLegacyImportBody,
  type AtmLegacyImportPreviewDto,
  type AtmLegacyImportRunDto,
  type AtmLegacyKind,
  type AtmLegacySource,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Checkbox, Field, Input } from '../../../../shared/ui/form';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../../shared/lib/errors';
import { formatNumber } from '../../../../shared/lib/format';
import { startLegacyImport } from '../../api/settings-api';
import { useAtmLegacyCutover, useAtmLegacyPreview } from '../../api/settings-queries';
import { listSeparator } from '../../lib/register-import-view';
import { toLocalInputValue } from '../ReplenishmentDialogs';

/** The source being imported, as the card names it. */
export interface LegacyImportSubject {
  source: AtmLegacySource;
  /** The source's branch, as the card reads it. */
  branch: string;
}

/**
 * The moment a cut typed in the box names — empty is no cut. The box shows minutes; the server's
 * own suggestion is kept to the second until the box is changed.
 */
export const cutoverFromLocal = (value: string): string | null =>
  value === '' ? null : new Date(value).toISOString();

export const legacyImportBody = (
  source: AtmLegacySource,
  cutoverAt: string | null,
  includeOpen: boolean,
): AtmLegacyImportBody => ({ source, cutoverAt, includeOpen });

/** «استيراد» runs only on a preview that found rows, decided both modes, and has rows to copy. */
export const legacyImportAllowed = (preview: AtmLegacyImportPreviewDto): boolean =>
  preview.sourceFound &&
  ATM_LEGACY_KINDS.every((kind) => preview[kind].timeModeClear) &&
  ATM_LEGACY_KINDS.some((kind) => preview[kind].toImport > 0);

/** The kinds whose rows leave the time mode undecided. */
export const unclearKinds = (preview: AtmLegacyImportPreviewDto): AtmLegacyKind[] =>
  ATM_LEGACY_KINDS.filter((kind) => !preview[kind].timeModeClear);

const cell = 'px-2.5 py-1.5';

/** What the preview says, both kinds side by side. */
const PreviewBody = ({ preview }: { preview: AtmLegacyImportPreviewDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const n = (value: number): string => formatNumber(value, locale);

  if (!preview.sourceFound) {
    return (
      <p
        className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        data-legacy-nothing="true"
      >
        {t('atm.settings.legacy.nothing')}
      </p>
    );
  }

  const unclear = unclearKinds(preview);
  const codes = ATM_LEGACY_KINDS.flatMap((kind) =>
    preview[kind].unresolvedCodes.map((entry) => `${entry.code} (${n(entry.rows)})`),
  );
  const row = (key: string, values: [number, number], strong = false) => (
    <tr
      key={key}
      className="border-t border-slate-100 first:border-t-0 dark:border-slate-800"
      data-legacy-count={key}
    >
      <td className={`${cell} text-start`}>{t(`atm.settings.legacy.count.${key}`)}</td>
      {values.map((value, index) => (
        <td
          key={ATM_LEGACY_KINDS[index]}
          className={`${cell} text-end ${strong ? 'font-semibold' : ''}`}
        >
          {n(value)}
        </td>
      ))}
    </tr>
  );
  const both = (pick: (kind: AtmLegacyKind) => number): [number, number] => [
    pick('replenishment'),
    pick('maintenance'),
  ];

  return (
    <>
      <section className="space-y-1.5">
        <h4 className="font-semibold text-slate-700 dark:text-slate-200">
          {t('atm.settings.legacy.counts')}
        </h4>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-slate-500 dark:text-slate-400">
              <th className={`${cell} text-start font-normal`} />
              {ATM_LEGACY_KINDS.map((kind) => (
                <th key={kind} className={`${cell} text-end font-normal`}>
                  {t(`atm.settings.legacy.kind.${kind}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row(
              'total',
              both((kind) => preview[kind].total),
            )}
            {ATM_LEGACY_SKIP_REASONS.map((reason) =>
              row(
                reason,
                both((kind) => preview[kind].skipped[reason]),
              ),
            )}
            {row(
              'toImport',
              both((kind) => preview[kind].toImport),
              true,
            )}
          </tbody>
        </table>
      </section>

      <section className="space-y-1" data-legacy-modes="true">
        <h4 className="font-semibold text-slate-700 dark:text-slate-200">
          {t('atm.settings.legacy.times')}
        </h4>
        <ul className="list-disc space-y-0.5 ps-5 text-[13px]">
          {ATM_LEGACY_KINDS.map((kind) => (
            <li key={kind} data-legacy-mode={kind}>
              {t(`atm.settings.legacy.mode.${preview[kind].timeMode}`, {
                kind: t(`atm.settings.legacy.kind.${kind}`),
                matching: n(
                  preview[kind].timeMode === 'utc'
                    ? preview[kind].evidence.asWritten
                    : preview[kind].evidence.cairoShifted,
                ),
                rows: n(preview[kind].evidence.rows),
              })}
            </li>
          ))}
        </ul>
      </section>

      {codes.length > 0 && (
        <div
          role="status"
          className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          data-legacy-unresolved="true"
        >
          <p>{t('atm.settings.legacy.unresolved')}</p>
          <p className="text-xs">{codes.join(listSeparator(locale))}</p>
        </div>
      )}

      {unclear.length > 0 && (
        <section
          role="alert"
          className="space-y-1 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200"
          data-legacy-unclear="true"
        >
          {t('atm.settings.legacy.unclear', {
            kinds: unclear
              .map((kind) => t(`atm.settings.legacy.kind.${kind}`))
              .join(listSeparator(locale)),
          })}
        </section>
      )}
    </>
  );
};

/** Open while `subject` names a source; closed (and asking nothing) while it is null. */
export const LegacyHistoryDialog = ({
  subject,
  onClose,
  onStarted,
}: {
  subject: LegacyImportSubject | null;
  onClose: () => void;
  onStarted: (run: AtmLegacyImportRunDto) => void;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const suggested = useAtmLegacyCutover(subject?.source ?? null);
  /** The cut as a moment (ISO) — `undefined` until the server's suggestion has answered. */
  const [cutover, setCutover] = useState<string | null | undefined>(undefined);
  const [includeOpen, setIncludeOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  // A fresh dialog starts from the server's suggestion, once it has answered.
  useEffect(() => {
    setCutover(undefined);
    setIncludeOpen(false);
  }, [subject?.source]);
  useEffect(() => {
    if (cutover !== undefined || suggested.data === undefined) return;
    setCutover(suggested.data.suggestedCutoverAt);
  }, [cutover, suggested.data]);

  const body =
    subject === null || cutover === undefined
      ? null
      : legacyImportBody(subject.source, cutover, includeOpen);
  const preview = useAtmLegacyPreview(body);
  const allowed =
    preview.data !== undefined &&
    !preview.isFetching &&
    !preview.isError &&
    legacyImportAllowed(preview.data);

  const confirm = async (): Promise<void> => {
    if (body === null || !allowed) return;
    setStarting(true);
    try {
      onStarted(await startLegacyImport(body));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, locale));
    } finally {
      setStarting(false);
    }
  };

  const names = { source: subject?.source ?? '', branch: subject?.branch ?? '' };
  return (
    <Dialog
      open={subject !== null}
      onClose={onClose}
      size="lg"
      title={t('atm.settings.legacy.title', names)}
      // A preview of tens of thousands of rows takes seconds; a stray click must not lose it.
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="secondary" disabled={starting} onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button
            loading={starting}
            disabled={!allowed}
            data-legacy-action="confirm"
            onClick={() => void confirm()}
          >
            {t('atm.settings.legacy.confirm')}
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-3.5 text-sm text-slate-700 dark:text-slate-200"
        data-legacy-dialog={subject?.source}
      >
        <p>{t('atm.settings.legacy.intro', names)}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('atm.settings.legacy.keeps')}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={t('atm.settings.legacy.cutover')}
            htmlFor="atm-legacy-cutover"
            hint={t('atm.settings.legacy.cutoverHint')}
          >
            <Input
              id="atm-legacy-cutover"
              type="datetime-local"
              value={cutover === undefined || cutover === null ? '' : toLocalInputValue(cutover)}
              disabled={cutover === undefined}
              onChange={(e) => setCutover(cutoverFromLocal(e.target.value))}
            />
          </Field>
          <div className="pb-2" data-legacy-field="includeOpen">
            <Checkbox
              label={t('atm.settings.legacy.includeOpen')}
              checked={includeOpen}
              onChange={() => setIncludeOpen((value) => !value)}
            />
          </div>
        </div>
        {suggested.isError ? (
          <ErrorState error={suggested.error} onRetry={() => void suggested.refetch()} />
        ) : preview.isLoading || cutover === undefined ? (
          <p className="text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : preview.isError ? (
          <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
        ) : preview.data !== undefined ? (
          <PreviewBody preview={preview.data} />
        ) : null}
      </div>
    </Dialog>
  );
};
