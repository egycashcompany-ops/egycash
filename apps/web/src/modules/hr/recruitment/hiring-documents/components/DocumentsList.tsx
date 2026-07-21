// The per-type document checklist: every active document type with its uploaded file (or a
// "missing" state), plus download / replace / version-history / upload actions. Required types are
// flagged; missing required ones are highlighted. Uploads/replaces are gated by the caller.
import {
  type HiringDocumentItemDto,
  type HiringDocumentTypeDto,
  type HiringDocumentsDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Badge } from '../../../../../shared/ui/Badge';
import { Button } from '../../../../../shared/ui/Button';
import { DownloadIcon } from '../../../../../shared/ui/icons';
import { formatDateTime, formatNumber, localized } from '../../../../../shared/lib/format';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { fileDownloadTicket } from '../../applicants/api/applicant-api';

export interface DocumentRow {
  typeId: string;
  typeName: { ar: string; en: string };
  required: boolean;
  doc: HiringDocumentItemDto | null;
}

/** Merge the active type catalog with the uploaded documents into one ordered checklist. */
const buildRows = (docs: HiringDocumentsDto, types: HiringDocumentTypeDto[]): DocumentRow[] => {
  const byType = new Map(docs.documents.map((d) => [d.typeId, d]));
  const rows: DocumentRow[] = types.map((ty) => ({
    typeId: ty.id,
    typeName: ty.name,
    required: ty.required,
    doc: byType.get(ty.id) ?? null,
  }));
  // Any uploaded documents whose type is no longer active still surface (read-only).
  const known = new Set(types.map((ty) => ty.id));
  for (const d of docs.documents) {
    if (!known.has(d.typeId)) rows.push({ typeId: d.typeId, typeName: d.typeName, required: d.required, doc: d });
  }
  return rows;
};

export const DocumentsList = ({
  docs,
  types,
  canUpload,
  onUpload,
  onReplace,
  onVersions,
}: {
  docs: HiringDocumentsDto;
  types: HiringDocumentTypeDto[];
  canUpload: boolean;
  onUpload: (typeId: string) => void;
  onReplace: (typeId: string) => void;
  onVersions: (typeId: string) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const rows = buildRows(docs, types);

  const download = async (fileId: string): Promise<void> => {
    try {
      const ticket = await fileDownloadTicket(fileId);
      window.open(ticket.url, '_blank', 'noopener');
    } catch {
      toast.error(t('hiringDocs.doc.downloadFailed'));
    }
  };

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((row) => {
        const doc = row.doc;
        return (
          <li key={row.typeId} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{localized(row.typeName, locale)}</span>
                {row.required && <Badge tone="brand">{t('hiringDocs.doc.required')}</Badge>}
                {doc === null ? (
                  <Badge tone={row.required ? 'danger' : 'neutral'}>{t('hiringDocs.doc.missing')}</Badge>
                ) : (
                  <Badge tone="success">{t('hiringDocs.doc.uploaded')}</Badge>
                )}
              </div>
              {doc !== null && (
                <p className="text-xs text-slate-400">
                  <span dir="ltr">{doc.fileName}</span> · {t('hiringDocs.versions.version', { n: formatNumber(doc.fileVersion, locale) })} ·{' '}
                  {formatDateTime(doc.uploadedAt, locale)}
                  {doc.notes !== null && doc.notes !== '' ? ` · ${doc.notes}` : ''}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {doc !== null && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => void download(doc.fileId)} aria-label={t('common.download')}>
                    <DownloadIcon className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onVersions(row.typeId)}>{t('hiringDocs.doc.versions')}</Button>
                  {canUpload && (
                    <Button size="sm" variant="ghost" onClick={() => onReplace(row.typeId)}>{t('hiringDocs.doc.replace')}</Button>
                  )}
                </>
              )}
              {doc === null && canUpload && (
                <Button size="sm" variant="secondary" onClick={() => onUpload(row.typeId)}>{t('hiringDocs.doc.upload')}</Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
