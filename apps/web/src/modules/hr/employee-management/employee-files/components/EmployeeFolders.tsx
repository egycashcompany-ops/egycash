// «ملفات الموظفين» as folders, the same shelf «مستندات المتقدمين» uses: one 3D folder per employee,
// their photo on the front, the number of files in the corner, their name, code and job under it.
//
// Opening one shows the employee's data (code, job, department, hire date, file status) and two
// drawers — the hiring documents copied into the file, and the other documents HR added — each
// listing its files with Open and Download. «الملف الكامل» goes to the detail page, which keeps the
// recruitment history, the file's timeline and notes.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type EmployeeFileDocumentDto, type EmployeeFileDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { useCan } from '../../../../../platform/rbac/Can';
import { cn } from '../../../../../shared/lib/cn';
import { formatDate, formatDateTime } from '../../../../../shared/lib/format';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Input } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import {
  ChevronStartIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FolderIcon,
  TrashIcon,
  UserIcon,
} from '../../../../../shared/ui/icons';
import { FolderShell } from '../../../recruitment/applicant-documents/components/folder-shell';
import { openFull, Preview, save } from '../../../recruitment/applicant-documents/components/folder-file-bits';
import {
  useEmployeeFile,
  useRemoveEmployeeFileDocument,
  useUploadEmployeeFileDocument,
} from '../api/employee-file-queries';
import { EmployeeFileStatusBadge } from './EmployeeFileStatusBadge';

type DrawerId = 'hiring' | 'other';

const nameOf = (f: EmployeeFileDto, locale: Locale): string =>
  f.owner == null ? f.employeeCode : locale === 'en' ? (f.owner.nameEn ?? f.owner.nameAr) : f.owner.nameAr;

const drawerFiles = (f: EmployeeFileDto, id: DrawerId): EmployeeFileDocumentDto[] =>
  f.documents.filter((d) => (id === 'hiring' ? d.source === 'hiringDocumentCopy' : d.source === 'custom'));

const Face = ({ file, name }: { file: EmployeeFileDto; name: string }): JSX.Element => (
  <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-white/15 ring-2 ring-white/70">
    {file.owner?.photoFileId != null ? (
      <Preview fileId={file.owner.photoFileId} alt={name} className="text-white" />
    ) : (
      <UserIcon className="h-7 w-7 text-white/80" />
    )}
  </span>
);

// ── The shelf ─────────────────────────────────────────────────────────────

export const EmployeeFolders = ({ files }: { files: EmployeeFileDto[] }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [open, setOpen] = useState<EmployeeFileDto | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {files.map((f) => {
          const name = nameOf(f, locale);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setOpen(f)}
              className="group flex w-full flex-col items-center gap-3 rounded-2xl p-3 text-center outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-900/70"
            >
              <FolderShell
                size="lg"
                face={<Face file={f} name={name} />}
                endBadge={t('hr.applicantFolders.files', { n: f.documents.length })}
                startBadge={
                  f.status === 'archived' ? (
                    <span className="absolute bottom-2 start-2 rounded-full bg-slate-900/40 px-2 py-0.5 text-[11px] font-bold text-white">
                      {t('employeeFiles.status.archived')}
                    </span>
                  ) : undefined
                }
              />
              <span className="w-full min-w-0">
                <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">{name}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                  {f.employeeCode}
                </span>
                {f.owner?.jobTitle != null && (
                  <span className="block truncate text-xs text-slate-400 dark:text-slate-500">{f.owner.jobTitle[locale]}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <EmployeeFolderDialog file={open} onClose={() => setOpen(null)} />
    </>
  );
};

// ── Inside one folder ─────────────────────────────────────────────────────

const Fact = ({ label, value }: { label: string; value: React.ReactNode }): JSX.Element => (
  <div className="min-w-0">
    <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</dd>
  </div>
);

const DrawerTile = ({ id, count, onOpen }: { id: DrawerId; count: number; onOpen: () => void }): JSX.Element => {
  const t = useT();
  const Glyph = id === 'hiring' ? FileIcon : FolderIcon;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col items-center gap-2 rounded-2xl p-2 text-center outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-900/70"
    >
      <FolderShell size="sm" dimmed={count === 0} face={<Glyph className="h-7 w-7 text-white/85" />} />
      <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">{t(`employeeFiles.folder.drawer.${id}`)}</span>
      <span className="block text-xs text-slate-500 dark:text-slate-400">
        {count === 0 ? t('hr.applicantFolders.subEmpty') : t('hr.applicantFolders.files', { n: count })}
      </span>
    </button>
  );
};

const FileList = ({ file, drawer }: { file: EmployeeFileDto; drawer: DrawerId }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const upload = useUploadEmployeeFileDocument(file.id);
  const remove = useRemoveEmployeeFileDocument(file.id);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const docs = drawerFiles(file, drawer);
  const mayEdit = can('employeeFile.upload');

  const pick = async (picked: File | undefined): Promise<void> => {
    if (picked === undefined) return;
    try {
      await upload.mutateAsync({ file: picked, name: name.trim() === '' ? picked.name : name.trim(), version: file.version });
      toast.success(t('employeeFiles.documents.uploaded'));
      setName('');
    } catch {
      // surfaced globally
    } finally {
      if (input.current !== null) input.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      {drawer === 'other' && mayEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <Input className="flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('employeeFiles.documents.namePlaceholder')} maxLength={200} />
          <input ref={input} type="file" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()}>
            {t('employeeFiles.documents.upload')}
          </Button>
        </div>
      )}
      {docs.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">{t('employeeFiles.documents.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800">
                {/\.(png|jpe?g|webp|gif)$/i.test(d.fileName) ? <Preview fileId={d.fileId} alt={d.name} /> : <FileIcon className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{d.name}</span>
                <span className="block truncate text-xs text-slate-400">
                  {d.fileName} · {formatDateTime(d.uploadedAt, locale)}
                </span>
              </span>
              <button
                type="button"
                title={t('employeeFiles.folder.open')}
                aria-label={`${t('employeeFiles.folder.open')} — ${d.name}`}
                onClick={() => void openFull(d.fileId).then((ok) => !ok && toast.error(t('hr.applicantFolders.downloadFailed')))}
                className="rounded-lg p-2 text-slate-500 hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-950/40"
              >
                <ExternalLinkIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                title={t('employeeFiles.folder.download')}
                aria-label={`${t('employeeFiles.folder.download')} — ${d.name}`}
                onClick={() => void save(d.fileId, d.fileName).then((ok) => !ok && toast.error(t('hr.applicantFolders.downloadFailed')))}
                className="rounded-lg p-2 text-slate-500 hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-950/40"
              >
                <DownloadIcon className="h-4 w-4" />
              </button>
              {mayEdit && (
                <button
                  type="button"
                  aria-label={t('common.remove')}
                  onClick={() =>
                    void remove
                      .mutateAsync({ documentId: d.id, version: file.version })
                      .then(() => toast.success(t('employeeFiles.documents.removed')))
                      .catch(() => undefined)
                  }
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const EmployeeFolderDialog = ({ file, onClose }: { file: EmployeeFileDto | null; onClose: () => void }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const live = useEmployeeFile(file?.id ?? '');
  const f = live.data ?? file;
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDrawer(null), [file?.id]);
  // Escape backs out of the drawer first, then closes the folder (as on «مستندات المتقدمين»).
  useEffect(() => {
    if (drawer === null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setDrawer(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [drawer]);

  const downloadable = f === null ? [] : drawer === null ? f.documents : drawerFiles(f, drawer);
  const downloadAll = async (): Promise<void> => {
    setSaving(true);
    let failed = 0;
    for (const d of downloadable) {
      if (!(await save(d.fileId, d.fileName))) failed += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
    setSaving(false);
    if (failed > 0) toast.error(t('hr.applicantFolders.downloadFailed'));
  };

  return (
    <Dialog
      open={file !== null}
      onClose={onClose}
      title={f === null ? '' : nameOf(f, locale)}
      description={f === null ? '' : `${f.employeeCode} · ${t('hr.applicantFolders.files', { n: f.documents.length })}`}
      size="xl"
      footer={
        <>
          {drawer !== null && (
            <Button variant="secondary" onClick={() => setDrawer(null)}>
              <ChevronStartIcon className="h-4 w-4" />
              {t('hr.applicantFolders.back')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('hr.applicantFolders.close')}
          </Button>
          {f !== null && (
            <Button variant="ghost" onClick={() => navigate(`/employee-files/${f.id}`)}>
              <ExternalLinkIcon className="h-4 w-4" />
              {t('employeeFiles.folder.fullFile')}
            </Button>
          )}
          <Button loading={saving} disabled={downloadable.length === 0} onClick={() => void downloadAll()}>
            <DownloadIcon className="h-4 w-4" />
            {t(drawer === null ? 'hr.applicantFolders.downloadAll' : 'hr.applicantFolders.downloadDrawer')}
          </Button>
        </>
      }
    >
      {f !== null &&
        (drawer === null ? (
          <div className="space-y-6">
            {/* The employee's data */}
            <section className="flex flex-wrap items-center gap-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-600 ring-2 ring-brand-200 dark:ring-brand-900">
                {f.owner?.photoFileId != null ? (
                  <Preview fileId={f.owner.photoFileId} alt={nameOf(f, locale)} className="text-white" />
                ) : (
                  <UserIcon className="h-8 w-8 text-white/85" />
                )}
              </span>
              <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <Fact label={t('employeeFiles.folder.code')} value={<span dir="ltr">{f.employeeCode}</span>} />
                <Fact label={t('employeeFiles.folder.jobTitle')} value={f.owner?.jobTitle?.[locale] ?? '—'} />
                <Fact label={t('employeeFiles.folder.department')} value={f.owner?.department?.[locale] ?? '—'} />
                <Fact label={t('employeeFiles.folder.hiredAt')} value={f.owner?.hiredAt != null ? formatDate(f.owner.hiredAt, locale) : '—'} />
                <Fact label={t('employeeFiles.folder.status')} value={<EmployeeFileStatusBadge status={f.status} />} />
                <Fact label={t('employeeFiles.folder.created')} value={formatDate(f.createdAt, locale)} />
              </dl>
            </section>
            {/* The drawers */}
            <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
              {(['hiring', 'other'] as const).map((id) => (
                <DrawerTile key={id} id={id} count={drawerFiles(f, id).length} onOpen={() => setDrawer(id)} />
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <nav className="flex items-center gap-1.5 text-sm">
              <button type="button" onClick={() => setDrawer(null)} className={cn('font-medium text-brand-700 hover:underline dark:text-brand-300')}>
                {nameOf(f, locale)}
              </button>
              <span className="text-slate-400">/</span>
              <span className="font-bold text-slate-900 dark:text-slate-100">{t(`employeeFiles.folder.drawer.${drawer}`)}</span>
            </nav>
            <FileList file={f} drawer={drawer} />
          </div>
        ))}
    </Dialog>
  );
};
