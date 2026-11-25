// The supplier's documents card «مستندات المورد» (design §11.4–§11.5, OD-11 A): the papers the
// company files to know who it buys from — the commercial registry, the tax card — each with what
// it is, its file and its scan state. Rebuilt in the module from IT's `CustodyReceipt.tsx` pattern
// (D-21): the bytes are guarded, so they are fetched with the session and shown as an object URL —
// a photo inline, a scanned PDF in a frame. Never a `/platform/files` listing (§11.4).
//
// What a paper offers comes from its scan state, read on the record and never stored (§11.5): a
// clean or unscanned file opens; one still being scanned waits («قيد الفحص»), the record reading
// itself again with backoff; a blocked file never opens («محظور»); a file gone or archived says
// «الملف غير متاح». A holder of `administrationSupplier.edit` files a paper and removes one, any
// state; both are edits of the supplier, so each carries the version the record was read at, and
// a moved version re-reads it. No paper is required (OD-76 A), and the list takes at most 20.
//
// The shared picker checks a file's size and nothing else on a drop, so the add refuses a file of
// another type itself, before it is sent: the server's own refusal names its category's key.
import { useEffect, useState } from 'react';
import {
  ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB,
  ADMINISTRATION_SUPPLIER_DOCUMENT_MIMES,
  type AdministrationSupplierAttachmentDto,
  type AdministrationSupplierDetailDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Dialog } from '../../../shared/ui/Dialog';
import { FileUpload } from '../../../shared/ui/FileUpload';
import { Field, Input } from '../../../shared/ui/form';
import { EyeIcon, FileIcon, TrashIcon, UploadIcon } from '../../../shared/ui/icons';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { fetchSupplierPaper } from '../api/suppliers-api';
import { useAddSupplierPaper, useRemoveSupplierPaper } from '../api/suppliers-queries';
import { paperSize, paperState, papersFull, type PaperChip } from '../lib/supplier-view';
import { AdministrationDialogFrame } from './AdministrationDialogFrame';

/** What a paper may be: a phone photo of the paper, or the office scanner's PDF (OD-76 (i)). */
export const SUPPLIER_PAPER_ACCEPT = ADMINISTRATION_SUPPLIER_DOCUMENT_MIMES.join(',');

/** Is this file one the documents' category takes (by its type, as the server reads it)? */
export const paperFileAllowed = (file: Pick<File, 'type'>): boolean =>
  (ADMINISTRATION_SUPPLIER_DOCUMENT_MIMES as readonly string[]).includes(file.type);

/** A paper's label, bounded as a file's display name is (the contract's 200). */
const LABEL_MAX = 200;

const CHIP: Record<PaperChip, { tone: 'warning' | 'danger' | 'neutral'; key: string }> = {
  pending: { tone: 'warning', key: 'administration.suppliers.papers.scan.pending' },
  blocked: { tone: 'danger', key: 'administration.suppliers.papers.scan.blocked' },
  unavailable: { tone: 'neutral', key: 'administration.suppliers.papers.scan.unavailable' },
};

/**
 * A paper's bytes as an object URL while its viewer is open. A 422 is a scan that has not answered
 * yet (`fetchBlob` reads no error body, §11.5): the record is read again so its chip says so.
 */
const usePaperUrl = (
  supplierId: string,
  paper: AdministrationSupplierAttachmentDto | null,
  onScanPending: () => void,
): { url: string | null; loading: boolean; failed: 'scan' | 'other' | null } => {
  const [state, setState] = useState<{
    url: string | null;
    loading: boolean;
    failed: 'scan' | 'other' | null;
  }>({ url: null, loading: false, failed: null });
  const attachmentId = paper?.attachmentId ?? null;
  useEffect(() => {
    if (attachmentId === null) {
      setState({ url: null, loading: false, failed: null });
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ url: null, loading: true, failed: null });
    void fetchSupplierPaper(supplierId, attachmentId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, loading: false, failed: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const scan = error instanceof ApiError && error.status === 422;
        if (scan) onScanPending();
        setState({ url: null, loading: false, failed: scan ? 'scan' : 'other' });
      });
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [supplierId, attachmentId]);
  return state;
};

/** One paper, large — a photo inline, a PDF in a frame — with «فتح في نافذة جديدة». */
const PaperViewer = ({
  supplierId,
  paper,
  onClose,
  onScanPending,
}: {
  supplierId: string;
  paper: AdministrationSupplierAttachmentDto | null;
  onClose: () => void;
  onScanPending: () => void;
}): JSX.Element => {
  const t = useT();
  const { url, loading, failed } = usePaperUrl(supplierId, paper, onScanPending);
  return (
    <Dialog
      open={paper !== null}
      onClose={onClose}
      size="xl"
      title={paper?.label ?? ''}
      {...(paper === null ? {} : { description: paper.fileName })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          {url !== null && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {t('administration.suppliers.papers.openNewTab')}
            </a>
          )}
        </>
      }
    >
      {loading && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
      )}
      {failed !== null && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {t(
            failed === 'scan'
              ? 'administration.suppliers.papers.stillScanning'
              : 'administration.suppliers.papers.loadFailed',
          )}
        </p>
      )}
      {url !== null &&
        paper !== null &&
        (paper.mime === 'application/pdf' ? (
          <iframe
            src={url}
            title={paper.label}
            className="h-[70vh] w-full rounded-lg border border-slate-200 dark:border-slate-700"
          />
        ) : (
          <img src={url} alt={paper.label} className="mx-auto max-h-[70vh] rounded-lg" />
        ))}
    </Dialog>
  );
};

/** File a paper: what it is, and its file — both required; Save stays pressable. */
const AddPaperDialog = ({
  open,
  onClose,
  supplier,
}: {
  open: boolean;
  onClose: () => void;
  supplier: AdministrationSupplierDetailDto;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const add = useAddSupplierPaper();
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [wrongType, setWrongType] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  // The picker keeps its own list: a fresh one per opening, so a closed dialog forgets its file —
  // and a fresh one after a refused file, so the picker never lists what will not be filed.
  const [opening, setOpening] = useState(0);
  useEffect(() => {
    if (!open) return;
    setLabel('');
    setFile(null);
    setWrongType(false);
    setFailure(null);
    setOpening((n) => n + 1);
  }, [open]);
  const pick = (files: File[]): void => {
    const picked = files[0] ?? null;
    if (picked !== null && !paperFileAllowed(picked)) {
      setFile(null);
      setWrongType(true);
      setOpening((n) => n + 1);
      return;
    }
    setWrongType(false);
    setFile(picked);
  };
  const required = useRequiredFields(
    [
      {
        key: 'label',
        label: t('administration.suppliers.papers.label'),
        ok: label.trim() !== '',
      },
      { key: 'file', label: t('administration.suppliers.papers.file'), ok: file !== null },
    ],
    open,
  );
  const save = async (): Promise<void> => {
    if (file === null) return;
    setFailure(null);
    try {
      await add.mutateAsync({
        id: supplier.id,
        file,
        label: label.trim(),
        version: supplier.version,
      });
      toast.success(t('administration.suppliers.papers.added'));
      onClose();
    } catch (error) {
      setFailure(error);
    }
  };
  return (
    <AdministrationDialogFrame
      open={open}
      onClose={onClose}
      title={t('administration.suppliers.papers.add')}
      description={`${localized(supplier.name, locale)} — ${supplier.code}`}
      required={required}
      onSave={save}
      busy={add.isPending}
      error={failure === null ? null : errorMessage(failure, locale)}
    >
      <Field
        label={t('administration.suppliers.papers.label')}
        hint={t('administration.suppliers.papers.labelHint')}
        required
        missing={required.isMissing('label')}
      >
        <Input value={label} maxLength={LABEL_MAX} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field
        label={t('administration.suppliers.papers.file')}
        hint={t('administration.suppliers.papers.fileHint')}
        required
        missing={required.isMissing('file')}
        error={wrongType ? t('administration.suppliers.papers.wrongType') : undefined}
      >
        <FileUpload
          key={opening}
          accept={SUPPLIER_PAPER_ACCEPT}
          maxSizeMb={ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB}
          onFiles={pick}
          disabled={add.isPending}
        />
      </Field>
    </AdministrationDialogFrame>
  );
};

/** Remove a paper's link — said first, since the record no longer lists it afterwards. */
const RemovePaperDialog = ({
  supplier,
  paper,
  onClose,
}: {
  supplier: AdministrationSupplierDetailDto;
  paper: AdministrationSupplierAttachmentDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const remove = useRemoveSupplierPaper();
  const [failure, setFailure] = useState<unknown>(null);
  useEffect(() => {
    if (paper !== null) setFailure(null);
  }, [paper]);
  const confirm = async (): Promise<void> => {
    if (paper === null) return;
    setFailure(null);
    try {
      await remove.mutateAsync({
        id: supplier.id,
        attachmentId: paper.attachmentId,
        version: supplier.version,
      });
      toast.success(t('administration.suppliers.papers.removed'));
      onClose();
    } catch (error) {
      setFailure(error);
    }
  };
  return (
    <Dialog
      open={paper !== null}
      onClose={onClose}
      title={t('administration.suppliers.papers.remove')}
      {...(paper === null ? {} : { description: paper.label })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => void confirm()}>
            {t('common.remove')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {failure !== null && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          >
            {errorMessage(failure, locale)}
          </p>
        )}
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('administration.suppliers.papers.removeBody')}
        </p>
      </div>
    </Dialog>
  );
};

export const SupplierDocuments = ({
  supplier,
  onScanPending,
  className,
}: {
  supplier: AdministrationSupplierDetailDto;
  /** A paper's viewer met a scan not yet answered: read the record again. */
  onScanPending: () => void;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const mayEdit = can('administrationSupplier.edit');
  const papers = supplier.attachments;
  const full = papersFull(papers);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<AdministrationSupplierAttachmentDto | null>(null);
  const [removing, setRemoving] = useState<AdministrationSupplierAttachmentDto | null>(null);

  const size = (bytes: number): string => {
    const { unit, size: figure } = paperSize(bytes, locale);
    return t(`administration.suppliers.papers.size.${unit}`, { size: figure });
  };

  return (
    <Card {...(className === undefined ? {} : { className })}>
      <CardHeader
        title={t('administration.suppliers.papers.title')}
        description={t('administration.suppliers.papers.caption', {
          size: formatNumber(ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB, locale),
        })}
        {...(mayEdit && !full
          ? {
              actions: (
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<UploadIcon className="h-4 w-4" />}
                  onClick={() => setAdding(true)}
                >
                  {t('administration.suppliers.papers.add')}
                </Button>
              ),
            }
          : {})}
      />
      <CardBody>
        {mayEdit && full && (
          <p
            className="mb-3 text-xs text-slate-500 dark:text-slate-400"
            data-supplier-papers-full=""
          >
            {t('administration.suppliers.papers.full')}
          </p>
        )}
        {papers.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('administration.suppliers.papers.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {papers.map((paper) => {
              const state = paperState(paper.scanStatus);
              return (
                <li
                  key={paper.attachmentId}
                  className="flex items-center gap-3 py-2"
                  data-supplier-paper={paper.attachmentId}
                >
                  <FileIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {paper.label}
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      <span dir="ltr">{paper.fileName}</span>
                      {' · '}
                      {size(paper.size)}
                      {' · '}
                      {formatDate(paper.addedAt, locale)}
                    </p>
                  </div>
                  {state.chip !== null && (
                    <Badge size="sm" tone={CHIP[state.chip].tone}>
                      {t(CHIP[state.chip].key)}
                    </Badge>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    {state.opens && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`${t('administration.suppliers.papers.open')} — ${paper.label}`}
                        title={t('administration.suppliers.papers.open')}
                        onClick={() => setViewing(paper)}
                      >
                        <EyeIcon className="h-4 w-4" />
                      </Button>
                    )}
                    {mayEdit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`${t('administration.suppliers.papers.remove')} — ${paper.label}`}
                        title={t('administration.suppliers.papers.remove')}
                        onClick={() => setRemoving(paper)}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>

      {mayEdit && (
        <AddPaperDialog open={adding} onClose={() => setAdding(false)} supplier={supplier} />
      )}
      {mayEdit && (
        <RemovePaperDialog supplier={supplier} paper={removing} onClose={() => setRemoving(null)} />
      )}
      <PaperViewer
        supplierId={supplier.id}
        paper={viewing}
        onClose={() => setViewing(null)}
        onScanPending={onScanPending}
      />
    </Card>
  );
};
