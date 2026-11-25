// The shelf of «الملفات»: one 3D folder per folder, its picture on the front, its file count in the
// corner, its name under it — the reference's shelf (`ApplicantFolders`), drawn with the module's
// own copy of the folder (`folder-shell.tsx`).
//
// What a person sees on it is what the server sends: every folder for the responsible person, and
// only the folders shared with them for anyone else. The responsible person's tile also carries two
// controls — edit and delete — on the CAPTION row, never over the drawing: shown on hover above
// `sm`, and always below it, where there is no pointer to hover with (the repo's `RowActions` rule,
// as the reference's bin is). The tile is therefore a container holding the folder button and its
// controls as siblings, because a button inside a button is invalid HTML.
import { type ComplianceFolderDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { EmptyState, LoadingState, Pagination, SearchInput } from '../../../shared/ui';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { EditIcon, FolderIcon, TrashIcon, UsersIcon } from '../../../shared/ui/icons';
import { useComplianceFolders } from '../api/compliance-queries';
import { FolderCover } from './file-bits';
import { FolderShell } from './folder-shell';

const PAGE_SIZE = 24;

/** As wide as its hint — the search box the reference's shelf uses. */
const SEARCH_FITS_TEXT = 'w-full sm:w-auto [&_input]:[field-sizing:content]';

const Face = ({ folder }: { folder: ComplianceFolderDto }): JSX.Element => {
  const glyph = <FolderIcon className="h-7 w-7 text-white/80" />;
  return (
    <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-white/15 ring-2 ring-white/70">
      {folder.hasCover ? (
        <FolderCover
          folderId={folder.id}
          version={folder.coverVersion}
          alt={folder.name}
          fallback={glyph}
        />
      ) : (
        glyph
      )}
    </span>
  );
};

const Tile = ({
  folder,
  manager,
  onOpen,
  onEdit,
  onDelete,
}: {
  folder: ComplianceFolderDto;
  manager: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="group relative" data-folder={folder.id}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col items-center gap-3 rounded-2xl p-3 text-center outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-900/70"
      >
        <FolderShell
          size="lg"
          face={<Face folder={folder} />}
          endBadge={t('compliance.files.count', { n: folder.documentCount })}
        />
        <span className={cn('w-full min-w-0', manager && 'pe-16')}>
          <span
            className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100"
            dir="auto"
            title={folder.name}
          >
            {folder.name}
          </span>
          {manager && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <UsersIcon className="h-3.5 w-3.5" />
              {folder.viewers.length === 0
                ? t('compliance.files.notShared')
                : t('compliance.files.sharedWith', { n: folder.viewers.length })}
            </span>
          )}
        </span>
      </button>
      {manager && (
        <span className="absolute bottom-2 end-0 flex items-center transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <button
            type="button"
            onClick={onEdit}
            title={t('compliance.folder.edit')}
            aria-label={`${t('compliance.folder.edit')} — ${folder.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-brand-50 hover:text-brand-700 dark:text-slate-400 dark:hover:bg-brand-950/40 dark:hover:text-brand-300"
          >
            <EditIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title={t('compliance.folder.delete')}
            aria-label={`${t('compliance.folder.delete')} — ${folder.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </span>
      )}
    </div>
  );
};

export const ComplianceFolders = ({
  manager,
  search,
  onSearch,
  page,
  onPage,
  onOpen,
  onEdit,
  onDelete,
}: {
  manager: boolean;
  /** The shelf's search and page live in the page's URL (`useRememberedFilters`), not here. */
  search: string;
  onSearch: (value: string) => void;
  page: number;
  onPage: (page: number) => void;
  onOpen: (folder: ComplianceFolderDto) => void;
  onEdit: (folder: ComplianceFolderDto) => void;
  onDelete: (folder: ComplianceFolderDto) => void;
}): JSX.Element => {
  const t = useT();
  const query = useComplianceFolders({
    page,
    pageSize: PAGE_SIZE,
    ...(search.trim() === '' ? {} : { search: search.trim() }),
  });
  const folders = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={onSearch}
          placeholder={t('compliance.files.searchPlaceholder')}
          className={SEARCH_FITS_TEXT}
        />
      </div>

      {query.isPending ? (
        <LoadingState />
      ) : query.isError || query.data === undefined ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : folders.length === 0 ? (
        <EmptyState
          title={
            search.trim() !== ''
              ? t('compliance.files.emptySearch')
              : manager
                ? t('compliance.files.emptyManager')
                : t('compliance.files.emptyReader')
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {folders.map((folder) => (
              <Tile
                key={folder.id}
                folder={folder}
                manager={manager}
                onOpen={() => onOpen(folder)}
                onEdit={() => onEdit(folder)}
                onDelete={() => onDelete(folder)}
              />
            ))}
          </div>
          <Pagination meta={query.data.meta} onPageChange={onPage} />
        </>
      )}
    </div>
  );
};
