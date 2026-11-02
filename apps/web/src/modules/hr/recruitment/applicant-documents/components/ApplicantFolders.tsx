// The Applicant documents page's folders: one 3D folder per applicant, their face on the front and
// their name under it. Opening one shows everything kept for that person — the National-ID card
// (front, back and the face cut from it) first, then the attachments HR added and the documents the
// candidate handed in — each with a preview and a download. The app's own colours (brand + slate).
import { useState } from 'react';
import {
  type ApplicantFolderDetailDto,
  type ApplicantFolderDto,
  type ApplicantFolderFileDto,
  type ApplicantFolderFileKind,
  type FileDto,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { cn } from '../../../../../shared/lib/cn';
import { formatDate } from '../../../../../shared/lib/format';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { EmptyState, LoadingState, Pagination, SearchInput } from '../../../../../shared/ui';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { DownloadIcon, FileIcon, ImageIcon, UserIcon } from '../../../../../shared/ui/icons';
import { fileTicket } from '../api/applicant-document-api';
import {
  useApplicantFolder,
  useApplicantFolders,
  useFileTicket,
} from '../api/applicant-document-queries';

const PAGE_SIZE = 24;

/** The card's three images, in the order they are shown. */
const CARD_KINDS = ['cardFront', 'cardBack', 'portrait'] as const;

const extensionOf = (file: FileDto): string => file.extension.replace(/^\./, '') || 'jpg';

/** The saved file's name: the card by applicant code and side, anything else by its own name. */
const downloadName = (code: string, item: ApplicantFolderFileDto): string => {
  const side: Partial<Record<ApplicantFolderFileKind, string>> = {
    cardFront: 'national-id-front',
    cardBack: 'national-id-back',
    portrait: 'photo',
    card: 'national-id',
  };
  const name = side[item.kind];
  return name === undefined ? item.file.originalName : `${code}-${name}.${extensionOf(item.file)}`;
};

/** Saves one file under `name`; opens it in a new tab if the bytes cannot be fetched directly. */
const save = async (fileId: string, name: string): Promise<boolean> => {
  try {
    const { url } = await fileTicket(fileId);
    try {
      const blob = await (await fetch(url)).blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      window.open(url, '_blank', 'noopener');
    }
    return true;
  } catch {
    return false;
  }
};

const sizeOf = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A signed-link image, with a quiet placeholder until (or unless) it loads. */
const Preview = ({
  fileId,
  alt,
  className,
  fit = 'cover',
}: {
  fileId: string | null;
  alt: string;
  className?: string;
  fit?: 'cover' | 'contain';
}): JSX.Element => {
  const { data } = useFileTicket(fileId);
  return data !== undefined ? (
    <img
      src={data.url}
      alt={alt}
      loading="lazy"
      className={cn(
        'h-full w-full',
        fit === 'cover' ? 'object-cover' : 'object-contain',
        className,
      )}
    />
  ) : (
    <span className={cn('flex h-full w-full items-center justify-center', className)}>
      <ImageIcon className="h-6 w-6 opacity-40" />
    </span>
  );
};

// ── The folder on the shelf ───────────────────────────────────────────────

const Folder = ({
  folder,
  onOpen,
}: {
  folder: ApplicantFolderDto;
  onOpen: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col items-center gap-3 rounded-2xl p-3 text-center outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-900/70"
    >
      <span className="relative block h-36 w-full max-w-[210px] [perspective:900px]">
        {/* Back panel with its tab */}
        <span className="absolute start-0 top-0 h-6 w-2/5 rounded-t-xl bg-brand-700 dark:bg-brand-800" />
        <span className="absolute inset-x-0 bottom-0 top-3 rounded-xl rounded-ss-none bg-brand-700 shadow-lg shadow-brand-900/20 dark:bg-brand-800" />
        {/* Papers inside, rising as the folder opens */}
        <span className="absolute inset-x-4 bottom-6 top-5 rounded-lg bg-white shadow-sm transition-transform duration-300 group-hover:-translate-y-3 group-hover:-rotate-2 dark:bg-slate-200" />
        <span className="absolute inset-x-6 bottom-6 top-7 rounded-lg bg-slate-50 shadow-sm transition-transform duration-300 group-hover:-translate-y-1.5 group-hover:rotate-2 dark:bg-slate-300" />
        {/* Front panel, tipping forward on hover */}
        <span className="absolute inset-x-0 bottom-0 top-10 flex origin-bottom items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 shadow-[0_-4px_12px_rgba(0,0,0,0.12)] ring-1 ring-white/10 transition-transform duration-300 [transform-style:preserve-3d] group-hover:[transform:rotateX(-22deg)]">
          <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-white/15 ring-2 ring-white/70">
            {folder.portraitFileId !== null ? (
              <Preview
                fileId={folder.portraitFileId}
                alt={folder.applicantName}
                className="text-white"
              />
            ) : (
              <UserIcon className="h-7 w-7 text-white/80" />
            )}
          </span>
          <span className="absolute bottom-2 end-2 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold text-white">
            {t('hr.applicantFolders.files', { n: folder.fileCount })}
          </span>
          {folder.hasCard && (
            <span className="absolute bottom-2 start-2 rounded-full bg-emerald-400/90 px-2 py-0.5 text-[11px] font-bold text-emerald-950">
              {t('hr.applicantFolders.idCard')}
            </span>
          )}
        </span>
      </span>
      <span className="w-full min-w-0">
        <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">
          {folder.applicantName}
        </span>
        <span className="block text-xs text-slate-500 dark:text-slate-400" dir="ltr">
          {folder.applicantCode}
        </span>
      </span>
    </button>
  );
};

// ── Inside one folder ─────────────────────────────────────────────────────

const DownloadButton = ({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:bg-brand-950/40 dark:hover:text-brand-200"
  >
    <DownloadIcon className="h-3.5 w-3.5" />
    {label}
  </button>
);

const CardTile = ({
  kind,
  item,
  code,
}: {
  kind: (typeof CARD_KINDS)[number];
  item: ApplicantFolderFileDto | undefined;
  code: string;
}): JSX.Element => {
  const t = useT();
  const label = t(`hr.applicantFolders.kind.${kind}`);
  return (
    <figure className="flex flex-col gap-2">
      <div
        className={cn(
          'relative overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700',
          kind === 'portrait'
            ? 'mx-auto aspect-[3/4] w-full max-w-[150px]'
            : 'aspect-[1.586] w-full',
        )}
      >
        {item !== undefined ? (
          <Preview
            fileId={item.file.id}
            alt={label}
            fit={kind === 'portrait' ? 'cover' : 'contain'}
            className="text-slate-400"
          />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-slate-400">
            <ImageIcon className="h-5 w-5" />
            {t('hr.applicantFolders.notOnFile')}
          </span>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        {item !== undefined && (
          <DownloadButton
            label={t('hr.applicantFolders.download')}
            onClick={() =>
              void save(item.file.id, downloadName(code, item)).then((done) => {
                if (!done) toast.error(t('hr.applicantFolders.downloadFailed'));
              })
            }
          />
        )}
      </figcaption>
    </figure>
  );
};

const FileRow = ({ item, code }: { item: ApplicantFolderFileDto; code: string }): JSX.Element => {
  const t = useT();
  const image = item.file.mime.startsWith('image/');
  return (
    <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
        {image ? (
          <Preview fileId={item.file.id} alt={item.file.displayName} />
        ) : (
          <FileIcon className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
          {item.file.displayName}
        </span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">
          {t(`hr.applicantFolders.kind.${item.kind}`)} · {sizeOf(item.file.size)}
        </span>
      </span>
      <DownloadButton
        label={t('hr.applicantFolders.download')}
        onClick={() =>
          void save(item.file.id, downloadName(code, item)).then((done) => {
            if (!done) toast.error(t('hr.applicantFolders.downloadFailed'));
          })
        }
      />
    </li>
  );
};

const FolderContents = ({ folder }: { folder: ApplicantFolderDetailDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const card = (kind: ApplicantFolderFileKind): ApplicantFolderFileDto | undefined =>
    folder.files.find((f) => f.kind === kind) ??
    // A card filed before sides were named: its first images stand in for front and back.
    (kind === 'cardFront' || kind === 'cardBack'
      ? folder.files.filter((f) => f.kind === 'card')[kind === 'cardFront' ? 0 : 1]
      : undefined);
  const shownAsCard = new Set(CARD_KINDS.map((k) => card(k)?.file.id).filter(Boolean));
  const others = folder.files.filter((f) => !shownAsCard.has(f.file.id));

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('hr.applicantFolders.registered', { date: formatDate(folder.registeredAt, locale) })}
      </p>
      <section className="space-y-3">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
          {t('hr.applicantFolders.cardTitle')}
        </h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_minmax(0,150px)]">
          {CARD_KINDS.map((kind) => (
            <CardTile key={kind} kind={kind} item={card(kind)} code={folder.applicantCode} />
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
          {t('hr.applicantFolders.otherFiles', { n: others.length })}
        </h4>
        {others.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {t('hr.applicantFolders.noOtherFiles')}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {others.map((item) => (
              <FileRow key={item.file.id} item={item} code={folder.applicantCode} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

const FolderDialog = ({
  folder,
  onClose,
}: {
  folder: ApplicantFolderDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const detail = useApplicantFolder(folder?.applicantId ?? '');
  const [saving, setSaving] = useState(false);

  /** Every file, one after another (a browser asks once before saving several). */
  const downloadAll = async (files: ApplicantFolderFileDto[], code: string): Promise<void> => {
    setSaving(true);
    let failed = 0;
    for (const item of files) {
      if (!(await save(item.file.id, downloadName(code, item)))) failed += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
    setSaving(false);
    if (failed > 0) toast.error(t('hr.applicantFolders.downloadFailed'));
  };

  return (
    <Dialog
      open={folder !== null}
      onClose={onClose}
      title={folder?.applicantName ?? ''}
      description={
        folder === null
          ? ''
          : `${folder.applicantCode} · ${t('hr.applicantFolders.files', { n: folder.fileCount })}`
      }
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('hr.applicantFolders.close')}
          </Button>
          <Button
            loading={saving}
            disabled={detail.data === undefined || detail.data.files.length === 0}
            onClick={() => {
              if (detail.data !== undefined)
                void downloadAll(detail.data.files, detail.data.applicantCode);
            }}
          >
            <DownloadIcon className="h-4 w-4" />
            {t('hr.applicantFolders.downloadAll')}
          </Button>
        </>
      }
    >
      {detail.isPending ? (
        <LoadingState />
      ) : detail.isError || detail.data === undefined ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <FolderContents folder={detail.data} />
      )}
    </Dialog>
  );
};

// ── The shelf ─────────────────────────────────────────────────────────────

export const ApplicantFolders = (): JSX.Element => {
  const t = useT();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<ApplicantFolderDto | null>(null);
  const query = useApplicantFolders({
    page,
    pageSize: PAGE_SIZE,
    ...(search.trim() === '' ? {} : { search: search.trim() }),
  });

  return (
    <div className="space-y-4">
      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder={t('hr.applicantFolders.searchPlaceholder')}
      />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError || query.data === undefined ? (
        <EmptyState title={t('hr.applicantFolders.loadFailed')} />
      ) : query.data.items.length === 0 ? (
        <EmptyState title={t('hr.applicantFolders.empty')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {query.data.items.map((folder) => (
              <Folder key={folder.applicantId} folder={folder} onOpen={() => setOpen(folder)} />
            ))}
          </div>
          <Pagination meta={query.data.meta} onPageChange={setPage} />
        </>
      )}
      <FolderDialog folder={open} onClose={() => setOpen(null)} />
    </div>
  );
};
