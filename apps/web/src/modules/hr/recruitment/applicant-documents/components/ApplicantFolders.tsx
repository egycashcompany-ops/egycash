// The Applicant documents page's folders: one 3D folder per applicant, their face on the front and
// their name under it. Opening one shows the three drawers inside — the National-ID card, what the
// candidate handed in through the portal, and what HR attached — each with previews and downloads.
// The app's own colours (brand + slate); the drawing itself is `FolderShell`.
//
// THE TILE IS NOT ONE BUTTON ANY MORE, and that is a structural change rather than a cosmetic one.
// A folder that can be deleted and ticked needs two more controls, and a button inside a button is
// invalid HTML that browsers quietly reshape. So the tile is a container holding the folder button
// and its controls as siblings.
//
// The bin sits on the CAPTION ROW beside the applicant's code, not over the folder's artwork: an
// icon floating on the drawing reads as part of the picture, and it lands on the paper or on the
// tab depending on the reading direction. On the caption row it is unmistakably this folder's, at
// every width. It still follows the repo's `RowActions` rule — on hover under a pointer, always
// visible below `sm`, where there is no pointer to hover with.
import { useMemo, useState } from 'react';
import { type ApplicantFolderDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { cn } from '../../../../../shared/lib/cn';
import { Button } from '../../../../../shared/ui/Button';
import {
  BulkActionBar,
  EmptyState,
  LoadingState,
  Pagination,
  SearchInput,
  useTableSelection,
} from '../../../../../shared/ui';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { CheckIcon, TrashIcon, UserIcon } from '../../../../../shared/ui/icons';
import {
  useApplicantFolders,
  useBulkDeleteApplicantFolders,
  useDeleteApplicantFolder,
  type FolderWithdrawal,
} from '../api/applicant-document-queries';
import { ApplicantFolderDialog } from './ApplicantFolderDialog';
import { DeleteFoldersDialog } from './DeleteFoldersDialog';
import { Preview } from './folder-file-bits';
import { FolderShell } from './folder-shell';

const PAGE_SIZE = 24;

// ── The folder on the shelf ───────────────────────────────────────────────

const Folder = ({
  folder,
  onOpen,
  onDelete,
  selecting,
  selected,
  onToggle,
}: {
  folder: ApplicantFolderDto;
  onOpen: () => void;
  /** Absent for a caller without the delete key — the control is then not rendered at all. */
  onDelete?: (() => void) | undefined;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}): JSX.Element => {
  const t = useT();
  const blocked =
    folder.deleteBlock === null
      ? undefined
      : t(`hr.applicantFolders.blocked.${folder.deleteBlock}`);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={selecting ? onToggle : onOpen}
        aria-pressed={selecting ? selected : undefined}
        className={cn(
          'flex w-full flex-col items-center gap-3 rounded-2xl p-3 text-center outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-900/70',
          selected && 'bg-brand-50 dark:bg-brand-950/40',
        )}
      >
        <FolderShell
          size="lg"
          face={
            folder.portraitFileId !== null ? (
              <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-white/15 ring-2 ring-white/70">
                <Preview
                  fileId={folder.portraitFileId}
                  alt={folder.applicantName}
                  className="text-white"
                />
              </span>
            ) : (
              <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-white/15 ring-2 ring-white/70">
                <UserIcon className="h-7 w-7 text-white/80" />
              </span>
            )
          }
          endBadge={t('hr.applicantFolders.files', { n: folder.fileCount })}
          startBadge={
            folder.hasCard ? (
              <span className="absolute bottom-2 start-2 rounded-full bg-emerald-400/90 px-2 py-0.5 text-[11px] font-bold text-emerald-950">
                {t('hr.applicantFolders.idCard')}
              </span>
            ) : undefined
          }
        />
        <span className={cn('w-full min-w-0', onDelete !== undefined && !selecting && 'pe-8')}>
          <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">
            {folder.applicantName}
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400" dir="ltr">
            {folder.applicantCode}
          </span>
        </span>
      </button>

      {/* The tick, while picking several — over the folder's front panel, where a picker's tick
          belongs, and clear of the two badges in its bottom corners. */}
      {selecting && (
        <label className="absolute start-5 top-14 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-white/90 shadow ring-1 ring-slate-200 dark:bg-slate-900/90 dark:ring-slate-700">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`${t('hr.applicantFolders.selectFolder')} — ${folder.applicantName}`}
            className="peer sr-only"
          />
          <CheckIcon
            className={cn(
              'h-4 w-4',
              selected ? 'text-brand-700 dark:text-brand-300' : 'text-transparent',
            )}
          />
        </label>
      )}

      {/*
        The bin. Painted on hover above `sm` and ALWAYS below it, because a phone has no pointer —
        the same rule `RowActions` applies to every table in the app. A folder that may not be
        deleted keeps the button, disabled, with the reason on it: an absent control teaches
        nothing, and «why can I not delete this one» is the question it has to answer.
      */}
      {onDelete !== undefined && !selecting && (
        <button
          type="button"
          onClick={onDelete}
          disabled={blocked !== undefined}
          title={blocked ?? t('hr.applicantFolders.deleteFolder')}
          aria-label={`${t('hr.applicantFolders.deleteFolder')} — ${folder.applicantName}`}
          className="absolute bottom-2 end-0 flex h-8 w-8 items-center justify-center rounded-lg text-red-600 transition-opacity hover:bg-red-50 disabled:text-slate-300 dark:text-red-400 dark:hover:bg-red-950/40 dark:disabled:text-slate-600 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

// ── The shelf ─────────────────────────────────────────────────────────────

export const ApplicantFolders = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const mayDelete = can('applicantDocument.delete');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<ApplicantFolderDto | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [confirming, setConfirming] = useState<ApplicantFolderDto[]>([]);
  const query = useApplicantFolders({
    page,
    pageSize: PAGE_SIZE,
    ...(search.trim() === '' ? {} : { search: search.trim() }),
  });
  const folders = query.data?.items ?? [];
  const selection = useTableSelection(useMemo(() => folders.map((f) => f.applicantId), [folders]));
  const deleteOne = useDeleteApplicantFolder();
  const deleteMany = useBulkDeleteApplicantFolders();

  /** The ticked folders, as rows rather than ids — the dialog names people, not identifiers. */
  const ticked = folders.filter((folder) => selection.selectedIds.has(folder.applicantId));

  /**
   * What the server did, said once.
   *
   * A partial result is the normal case for a selection, so «تم حذف ٣ مجلدات» and «تم الإبقاء على
   * واحد: …» are two sentences and not one: the second names the people whose folders were kept,
   * because the only useful thing to know about a refusal is whose it was.
   */
  const report = (
    deleted: number,
    withdrawn: number,
    refused: { applicantName: string }[],
  ): void => {
    if (deleted > 0) {
      toast.success(
        deleted === 1
          ? t('hr.applicantFolders.deleted')
          : t('hr.applicantFolders.deletedMany', { n: deleted }),
      );
    }
    // Said separately, and only when it happened. The withdrawal is a second act on somebody's
    // record and «تم سحب الطلب» is the only confirmation they get that it went through — while a
    // count SHORT of the folders emptied is how an operator finds out that one of them did not,
    // which is the case this exists for.
    if (withdrawn > 0) {
      toast.success(
        withdrawn === 1
          ? t('hr.applicantFolders.withdrawn')
          : t('hr.applicantFolders.withdrawnMany', { n: withdrawn }),
      );
    }
    if (refused.length > 0) {
      toast.warning(
        t('hr.applicantFolders.deleteRefused', {
          n: refused.length,
          names: refused.map((row) => row.applicantName).join('، '),
        }),
      );
    }
  };

  const confirm = async (
    chosen: ApplicantFolderDto[],
    withdrawal: FolderWithdrawal,
  ): Promise<void> => {
    try {
      if (chosen.length === 1 && chosen[0] !== undefined) {
        const result = await deleteOne.mutateAsync({
          applicantId: chosen[0].applicantId,
          withdrawal,
        });
        report(1, result.withdrawn ? 1 : 0, []);
      } else {
        const result = await deleteMany.mutateAsync({
          applicantIds: chosen.map((folder) => folder.applicantId),
          withdrawal,
        });
        report(
          result.deleted.length,
          result.deleted.filter((row) => row.withdrawn).length,
          result.refused,
        );
      }
      setConfirming([]);
      setOpen(null);
      selection.clear();
      setSelecting(false);
    } catch {
      // The API refuses a kept record on its own account even when the button was offered — a
      // folder can become one between the list being drawn and the bin being pressed.
      toast.error(t('hr.applicantFolders.deleteFailed'));
      setConfirming([]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder={t('hr.applicantFolders.searchPlaceholder')}
          />
        </div>
        {mayDelete && folders.length > 0 && (
          <Button
            variant={selecting ? 'secondary' : 'ghost'}
            onClick={() => {
              setSelecting(!selecting);
              selection.clear();
            }}
          >
            {t(selecting ? 'hr.applicantFolders.selectDone' : 'hr.applicantFolders.select')}
          </Button>
        )}
      </div>

      {selecting && (
        <BulkActionBar count={selection.count} onClear={selection.clear}>
          <Button
            variant="danger"
            size="sm"
            loading={deleteMany.isPending}
            onClick={() => setConfirming(ticked)}
          >
            <TrashIcon className="h-4 w-4" />
            {t('hr.applicantFolders.deleteSelected')}
          </Button>
        </BulkActionBar>
      )}

      {query.isPending ? (
        <LoadingState />
      ) : query.isError || query.data === undefined ? (
        <EmptyState title={t('hr.applicantFolders.loadFailed')} />
      ) : folders.length === 0 ? (
        <EmptyState title={t('hr.applicantFolders.empty')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {folders.map((folder) => (
              <Folder
                key={folder.applicantId}
                folder={folder}
                onOpen={() => setOpen(folder)}
                onDelete={mayDelete ? () => setConfirming([folder]) : undefined}
                selecting={selecting}
                selected={selection.selectedIds.has(folder.applicantId)}
                onToggle={() => selection.toggleRow(folder.applicantId)}
              />
            ))}
          </div>
          <Pagination meta={query.data.meta} onPageChange={setPage} />
        </>
      )}

      <ApplicantFolderDialog
        folder={open}
        onClose={() => setOpen(null)}
        onDelete={mayDelete ? (folder) => setConfirming([folder]) : undefined}
      />
      <DeleteFoldersDialog
        folders={confirming}
        onClose={() => setConfirming([])}
        onConfirm={confirm}
      />
    </div>
  );
};
