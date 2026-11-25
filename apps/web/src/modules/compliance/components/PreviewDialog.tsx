// «View» for a Word or an Excel file. A browser shows a PDF itself and it opens in a new tab; it
// cannot show a .docx or a .xlsx, so the server reads one into headings, paragraphs and tables, or
// into a workbook's visible sheets as rows, and they are drawn here — read-only, as everything a
// reader is given is. Formatting, pictures and formulas are not carried: «تنزيل» is the file itself.
// An older .doc or .xls, or a file that does not read, says so and offers the download.
//
// Each opening is counted by the server as one view, the same act as opening a PDF.
import { useState } from 'react';
import {
  type ComplianceDocumentDto,
  type CompliancePreviewBlockDto,
  type CompliancePreviewSheetDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { LoadingState } from '../../../shared/ui';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { DownloadIcon } from '../../../shared/ui/icons';
import { useDocumentPreview } from '../api/compliance-queries';

const Table = ({ rows }: { rows: string[][] }): JSX.Element => {
  const width = Math.max(1, ...rows.map((row) => row.length));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="min-w-full border-collapse text-sm">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
              {Array.from({ length: width }, (_, c) => (
                <td
                  key={c}
                  dir="auto"
                  className="whitespace-pre-wrap border-e border-slate-100 px-2 py-1.5 align-top text-slate-800 last:border-e-0 dark:border-slate-800 dark:text-slate-100"
                >
                  {row[c] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Blocks = ({ blocks }: { blocks: CompliancePreviewBlockDto[] }): JSX.Element => (
  <div className="space-y-3" data-preview="document">
    {blocks.map((block, index) =>
      block.type === 'heading' ? (
        <h4
          key={index}
          dir="auto"
          className="text-base font-bold text-slate-900 dark:text-slate-100"
        >
          {block.text}
        </h4>
      ) : block.type === 'paragraph' ? (
        <p
          key={index}
          dir="auto"
          className="whitespace-pre-wrap text-sm leading-7 text-slate-800 dark:text-slate-200"
        >
          {block.text}
        </p>
      ) : (
        <Table key={index} rows={block.rows} />
      ),
    )}
  </div>
);

const Sheets = ({ sheets }: { sheets: CompliancePreviewSheetDto[] }): JSX.Element => {
  const t = useT();
  const [active, setActive] = useState(0);
  const sheet = sheets[active] ?? sheets[0];
  if (sheet === undefined) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t('compliance.preview.emptySheet')}
      </p>
    );
  }
  return (
    <div className="space-y-3" data-preview="sheets">
      {sheets.length > 1 && (
        <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          {sheets.map((one, index) => (
            <button
              key={`${one.name}-${String(index)}`}
              type="button"
              aria-pressed={index === active}
              onClick={() => setActive(index)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                index === active
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {one.name}
            </button>
          ))}
        </div>
      )}
      {sheet.rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('compliance.preview.emptySheet')}
        </p>
      ) : (
        <Table rows={sheet.rows} />
      )}
    </div>
  );
};

export const PreviewDialog = ({
  document,
  onClose,
  onDownload,
}: {
  document: ComplianceDocumentDto | null;
  onClose: () => void;
  onDownload: (document: ComplianceDocumentDto) => void;
}): JSX.Element => {
  const t = useT();
  const preview = useDocumentPreview(document?.id ?? '');
  const data = preview.data;
  return (
    <Dialog
      open={document !== null}
      onClose={onClose}
      size="xl"
      tall
      title={document?.name ?? ''}
      {...(document === null ? {} : { description: document.fileName })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          {document !== null && (
            <Button onClick={() => onDownload(document)}>
              <DownloadIcon className="h-4 w-4" />
              {t('common.download')}
            </Button>
          )}
        </>
      }
    >
      {preview.isPending ? (
        <LoadingState />
      ) : preview.isError || data === undefined ? (
        <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
      ) : data.kind === 'unavailable' ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {t('compliance.preview.unavailable')}
        </p>
      ) : (
        <div className="space-y-3">
          {data.truncated && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {t('compliance.preview.truncated')}
            </p>
          )}
          {data.kind === 'document' ? (
            data.blocks.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('compliance.preview.emptyDocument')}
              </p>
            ) : (
              <Blocks blocks={data.blocks} />
            )
          ) : (
            <Sheets sheets={data.sheets} />
          )}
        </div>
      )}
    </Dialog>
  );
};
