// Upload → preview → approve → apply (spec §8.6, items 2–4).
//
// THE PREVIEW IS THE POINT. One apply writes thousands of register rows and creates, reactivates
// or relabels Operations machines, with no undo; so the file is read twice — once to see the plan
// (`apply` empty, nothing written), once for real with the categories the owner approved. The SAME
// `File` is posted both times, and the preview's `fileSha256` travels with the apply, so the server
// refuses (409) if the bytes are not the ones that were looked at. Nothing is kept on the server in
// between. An applied result is a fresh plan, so the next pass starts from it with nothing ticked.
import { useState } from 'react';
import {
  type AtmRegisterImportCategory,
  type AtmRegisterImportResultDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Card, CardBody } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { FileUpload } from '../../../../shared/ui/FileUpload';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useImportRegisterWorkbook } from '../../api/register-queries';
import {
  approvedCategories,
  importErrorDetails,
  importErrorText,
  listSeparator,
  outcomeEntries,
} from '../../lib/register-import-view';
import { ImportPreviewPanel } from './ImportPreviewPanel';

const XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_MB = 20;

export const ImportUploadPanel = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const run = useImportRegisterWorkbook();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AtmRegisterImportResultDto | null>(null);
  const [approved, setApproved] = useState<ReadonlySet<AtmRegisterImportCategory>>(new Set());
  const [reportOverride, setReportOverride] = useState(false);

  /** A new plan on screen: nothing approved, no override — every pass is decided afresh. */
  const show = (next: AtmRegisterImportResultDto | null): void => {
    setResult(next);
    setApproved(new Set());
    setReportOverride(false);
  };

  const pick = (files: File[]): void => {
    setFile(files[0] ?? null);
    show(null);
    run.reset();
  };

  const preview = (): void => {
    if (file === null) return;
    run.mutate({ file, apply: [] }, { onSuccess: show });
  };

  const apply = (): void => {
    if (file === null || result === null) return;
    run.mutate(
      {
        file,
        apply: approvedCategories(approved),
        fileSha256: result.fileSha256,
        reportOverride,
      },
      {
        onSuccess: (applied) => {
          show(applied);
          toast.success(
            t('atm.registerImport.applied', {
              summary: outcomeEntries(applied.applied?.counts ?? {})
                .map(([key, n]) => `${t(`atm.registerImport.outcome.${key}`)}: ${String(n)}`)
                .join(listSeparator(locale)),
            }),
          );
        },
      },
    );
  };

  const toggle = (category: AtmRegisterImportCategory): void =>
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const details = run.isError ? importErrorDetails(run.error, t) : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('atm.registerImport.intro')}
          </p>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('atm.registerImport.upload')}
          </p>
          <FileUpload accept={XLSX} maxSizeMb={MAX_MB} onFiles={pick} disabled={run.isPending} />
          {run.isError && (
            <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
              <p>{importErrorText(run.error, t, locale)}</p>
              {details.length > 0 && (
                <ul className="mt-1 list-disc ps-5 text-xs">
                  {details.map((line) => (
                    <li key={line} dir="auto">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex justify-end">
            <Button
              variant="secondary"
              disabled={file === null}
              loading={run.isPending && result === null}
              onClick={preview}
            >
              {t('atm.registerImport.preview')}
            </Button>
          </div>
        </CardBody>
      </Card>

      {result !== null && (
        <ImportPreviewPanel
          result={result}
          approved={approved}
          onToggle={toggle}
          reportOverride={reportOverride}
          onOverride={setReportOverride}
          onApply={apply}
          applying={run.isPending}
        />
      )}
    </div>
  );
};
