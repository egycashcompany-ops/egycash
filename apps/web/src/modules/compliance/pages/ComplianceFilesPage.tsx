// «الملفات» — Compliance and Risks' one page so far: a shelf of folders like HR's «مستندات
// المتقدمين» («شبه /applicant-documents من جهة الفولدرات»).
//
// The responsible person (`complianceFile.manage`) makes folders, names and renames them, puts a
// picture on each, says who in the company sees each, and files PDF, Word and Excel files of up to
// 20 MB inside — and sees who has opened each file, how many times, and when. Anyone else sees only
// the folders shared with them, and may open and download what is inside, nothing more.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type ComplianceFolderDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Can, useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { Button } from '../../../shared/ui/Button';
import { PlusIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useDeleteFolder } from '../api/compliance-queries';
import { ComplianceFolders } from '../components/ComplianceFolders';
import { ConfirmDeleteDialog } from '../components/ConfirmDeleteDialog';
import { FolderDialog } from '../components/FolderDialog';
import { FolderFormDialog } from '../components/FolderFormDialog';

/** Remembered across visits: the shelf's search. `page` is derived and never kept. */
const REMEMBERED_FILTERS = ['q'] as const;

export const ComplianceFilesPage = (): JSX.Element => {
  const t = useT();
  // The search lives in the URL so the shelf is shareable and survives a reload, written with
  // `replace`: narrowing the shelf is a view of this screen, not a place to go Back to.
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [name, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(name);
      else next.set(name, value);
    }
    if (!('page' in updates)) next.delete('page');
    setSp(next, { replace: true });
  };
  const search = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const manager = can('complianceFile.manage');
  const [open, setOpen] = useState<ComplianceFolderDto | null>(null);
  /** `null` closed; `{ folder: null }` a new folder; `{ folder }` an edit. */
  const [form, setForm] = useState<{ folder: ComplianceFolderDto | null } | null>(null);
  const [removing, setRemoving] = useState<ComplianceFolderDto | null>(null);
  const remove = useDeleteFolder();

  const confirmRemove = async (): Promise<void> => {
    if (removing === null) return;
    try {
      await remove.mutateAsync({ id: removing.id, version: removing.version });
      toast.success(t('compliance.folder.deleted'));
      if (open?.id === removing.id) setOpen(null);
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
    setRemoving(null);
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('compliance.nav.files')}
        breadcrumbs={[
          { label: t('compliance.module.title'), to: '/' },
          { label: t('compliance.nav.files') },
        ]}
        actions={
          <Can permission="complianceFile.manage">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setForm({ folder: null })}
            >
              {t('compliance.files.newFolder')}
            </Button>
          </Can>
        }
      />

      <ComplianceFolders
        manager={manager}
        search={search}
        onSearch={(value) => patch({ q: value })}
        page={page}
        onPage={(next) => patch({ page: next <= 1 ? null : String(next) })}
        onOpen={setOpen}
        onEdit={(folder) => setForm({ folder })}
        onDelete={setRemoving}
      />

      <FolderDialog
        folder={open}
        onClose={() => setOpen(null)}
        onEdit={manager ? (folder) => setForm({ folder }) : undefined}
        onDelete={manager ? setRemoving : undefined}
      />
      {manager && (
        <FolderFormDialog
          open={form !== null}
          folder={form?.folder ?? null}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            if (open?.id === saved.id) setOpen(saved);
          }}
        />
      )}
      <ConfirmDeleteDialog
        open={removing !== null}
        title={t('compliance.folder.deleteTitle', { name: removing?.name ?? '' })}
        body={t('compliance.folder.deleteBody', { n: removing?.documentCount ?? 0 })}
        busy={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      />
    </PageContainer>
  );
};
