// «استيراد السجل القديم» — one legacy source's preview, and the start of its import
// (docs/12-planning/atm-legacy-history-import.md). The dialog IS the confirmation, as the move's
// is (MoveBranchDataDialog): it opens on the server's PREVIEW — the rows the run would copy, each
// row it would leave out under the first rule it fails, how the old system wrote each kind's
// times — and «استيراد» stays held back until the preview allows it, with a sentence saying why.
// The run itself steps in the card, which shows its progress.
//
// Only operations closed in the old system («Done») are ever copied — the owner (2026-11-25): «عايز
// اللى يتنقل بس سجل الصيانة والتغذية اللى اتقفل Done» — so the dialog offers no switch for open ones.
// The cut is a MOMENT: the branch's first own row in ECMS, suggested by the server. A legacy row
// closed at or after it is the branch's own work, entered in ECMS, and is not copied.
import { useEffect, useState } from 'react';
import {
  ATM_LEGACY_KINDS,
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
import { Field, Input } from '../../../../shared/ui/form';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { cn } from '../../../../shared/lib/cn';
import { formatNumber } from '../../../../shared/lib/format';
import {
  useAtmLegacyCutover,
  useAtmLegacyPreview,
  useStartAtmLegacyImport,
} from '../../api/settings-queries';
import { listSeparator } from '../../lib/register-import-view';
import { toLocalInputValue } from '../ReplenishmentDialogs';
import {
  cutoverFromLocal,
  legacyErrorText,
  legacyImportAllowed,
  legacyImportBody,
  legacyRefusalText,
  shownSkipReasons,
  unclearKinds,
  unresolvedCodesText,
} from './legacy-history-view';

/** The source being imported, as the card names it. */
export interface LegacyImportSubject {
  source: AtmLegacySource;
  /** The source's branch, as the card reads it. */
  branch: string;
}

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
  const codes = unresolvedCodesText(preview, t, locale);
  const nothingToCopy = ATM_LEGACY_KINDS.every((kind) => preview[kind].toImport === 0);
  const row = (key: string, pick: (kind: AtmLegacyKind) => number) => (
    <tr
      key={key}
      className="border-t border-slate-100 first:border-t-0 dark:border-slate-800"
      data-legacy-count={key}
    >
      <td className={`${cell} text-start`}>{t(`atm.settings.legacy.count.${key}`)}</td>
      {ATM_LEGACY_KINDS.map((kind) => (
        <td key={kind} className={`${cell} text-end font-semibold`}>
          {n(pick(kind))}
        </td>
      ))}
    </tr>
  );

  return (
    <>
      <section className="space-y-1.5">
        <h4 className="font-semibold text-slate-700 dark:text-slate-200">
          {t('atm.settings.legacy.counts')}
        </h4>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-xs text-slate-500 dark:text-slate-400">
              <th className={`${cell} text-start font-medium`}>
                <span className="sr-only">{t('atm.settings.legacy.counts')}</span>
              </th>
              {ATM_LEGACY_KINDS.map((kind) => (
                <th key={kind} className={`${cell} text-end font-medium`}>
                  {t(`atm.settings.legacy.kind.${kind}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row('total', (kind) => preview[kind].total)}
            {shownSkipReasons(preview).map((reason) =>
              row(reason, (kind) => preview[kind].skipped[reason]),
            )}
            {row('toImport', (kind) => preview[kind].toImport)}
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

      {codes !== '' && (
        <div
          role="status"
          className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          data-legacy-unresolved="true"
        >
          <p>{t('atm.settings.legacy.unresolved')}</p>
          <p className="text-xs">{codes}</p>
        </div>
      )}

      {unclear.length > 0 ? (
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
      ) : (
        nothingToCopy && (
          <p
            className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            data-legacy-none-to-copy="true"
          >
            {t('atm.settings.legacy.noneToCopy')}
          </p>
        )
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
  const start = useStartAtmLegacyImport();
  /** The cut as a moment (ISO) — `undefined` until the server's suggestion has answered. */
  const [cutover, setCutover] = useState<string | null | undefined>(undefined);

  // A fresh dialog starts from the server's suggestion, once it has answered.
  useEffect(() => {
    setCutover(undefined);
  }, [subject?.source]);
  useEffect(() => {
    if (cutover !== undefined || suggested.data === undefined) return;
    if (suggested.data.source !== subject?.source) return;
    setCutover(suggested.data.suggestedCutoverAt);
  }, [cutover, suggested.data, subject?.source]);

  const body =
    subject === null || cutover === undefined ? null : legacyImportBody(subject.source, cutover);
  const preview = useAtmLegacyPreview(body);
  const allowed =
    preview.data !== undefined &&
    !preview.isFetching &&
    !preview.isError &&
    !preview.isPlaceholderData &&
    legacyImportAllowed(preview.data);

  const confirm = async (): Promise<void> => {
    if (body === null || !allowed) return;
    try {
      onStarted(await start.mutateAsync(body));
      onClose();
    } catch (error) {
      // The hook declares `onError`, so the global toast stays quiet: this is the one message.
      toast.error(legacyErrorText(error, t, locale));
    }
  };

  /** This card's own refusal in the reader's words; any other failure as the panel words it. */
  const refusal = (error: unknown): { description?: string } => {
    const text = legacyRefusalText(error, t);
    return text === undefined ? {} : { description: text };
  };

  const names = { source: subject?.source ?? '', branch: subject?.branch ?? '' };
  return (
    <Dialog
      open={subject !== null}
      onClose={onClose}
      size="lg"
      title={t('atm.settings.legacy.dialogTitle', names)}
      // A preview of tens of thousands of rows takes seconds; a stray click must not lose it.
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="secondary" disabled={start.isPending} onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button
            loading={start.isPending}
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
        <Field
          label={t('atm.settings.legacy.cutover')}
          htmlFor="atm-legacy-cutover"
          hint={t('atm.settings.legacy.cutoverHint')}
        >
          <Input
            id="atm-legacy-cutover"
            type="datetime-local"
            value={cutover === undefined || cutover === null ? '' : toLocalInputValue(cutover)}
            disabled={cutover === undefined || start.isPending}
            onChange={(e) => setCutover(cutoverFromLocal(e.target.value))}
          />
        </Field>
        {suggested.isError ? (
          <ErrorState
            error={suggested.error}
            {...refusal(suggested.error)}
            onRetry={() => void suggested.refetch()}
          />
        ) : cutover === undefined || preview.isLoading ? (
          <p className="text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : preview.isError ? (
          // An unreadable source is refused in the server's Arabic: worded here in the reader's.
          <ErrorState
            error={preview.error}
            {...refusal(preview.error)}
            onRetry={() => void preview.refetch()}
          />
        ) : preview.data !== undefined ? (
          <div
            className={cn(
              'flex flex-col gap-3.5 transition-opacity',
              preview.isPlaceholderData && 'opacity-60',
            )}
            aria-busy={preview.isPlaceholderData || undefined}
          >
            <PreviewBody preview={preview.data} />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
};
