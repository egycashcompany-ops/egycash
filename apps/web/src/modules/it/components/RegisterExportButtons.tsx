// The «Excel» and «PDF» buttons of an IT register — the custody register's and the asset list's —
// one control, so the two screens cannot drift apart. «كمان عايز الزرارين قبل مش بعد زرار الـ
// Action بتاع الفورم · كمان عايزك تشيل كلمة تصدير من الزراير»: the screen places them before its
// own action, and each says just what it makes.
//
// It owns what is the same on both: one file at a time, the spinner on the button pressed while the
// rows are gathered, and the failure NAMED rather than swallowed — a button that silently does
// nothing is read as broken, and pressed again. What the files hold is the screen's business.
import { useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Button } from '../../../shared/ui/Button';
import { DownloadIcon, FileIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';

export const RegisterExportButtons = ({
  name,
  onExcel,
  onPdf,
}: {
  /** `data-export` / `data-print` — which register, so a test can find the right pair. */
  name: string;
  /** Gathers the rows and saves the workbook. Rejects like any other request; this reports it. */
  onExcel: () => Promise<void>;
  /**
   * Opens the print tab — synchronously, inside the click — then gathers the rows and writes the
   * page. False when the browser blocked the tab.
   */
  onPdf: () => Promise<boolean>;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  // The job is CALLED before anything is awaited, so a print tab still opens inside the click.
  const run = async (kind: 'excel' | 'pdf'): Promise<void> => {
    if (exporting !== null) return;
    setExporting(kind);
    try {
      if (kind === 'excel') await onExcel();
      else if (!(await onPdf())) toast.error(t('it.custody.receipt.popupBlocked'));
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        data-export={name}
        title={t('it.export.excelHint')}
        disabled={exporting !== null}
        loading={exporting === 'excel'}
        leftIcon={<DownloadIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
        onClick={() => void run('excel')}
      >
        {t('it.export.excel')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        data-print={name}
        title={t('it.export.pdfHint')}
        disabled={exporting !== null}
        loading={exporting === 'pdf'}
        leftIcon={<FileIcon className="h-4 w-4 text-red-600 dark:text-red-400" />}
        onClick={() => void run('pdf')}
      >
        {t('it.export.pdf')}
      </Button>
    </>
  );
};
