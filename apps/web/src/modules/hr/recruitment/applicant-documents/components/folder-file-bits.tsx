// The pieces a folder's files are drawn with: a signed-link preview, a download button, a card
// tile and a file row. One module, because the sub-folders and the shelf both reach for them and
// neither owns them.
import {
  type ApplicantFolderFileDto,
  type ApplicantFolderFileKind,
  type FileDto,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { cn } from '../../../../../shared/lib/cn';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { DownloadIcon, FileIcon, ImageIcon } from '../../../../../shared/ui/icons';
import { fileTicket } from '../api/applicant-document-api';
import { useFileTicket } from '../api/applicant-document-queries';
import { type CardTileKind } from './applicant-folder-groups';

const extensionOf = (file: FileDto): string => file.extension.replace(/^\./, '') || 'jpg';

/**
 * The saved file's name: the card by applicant code and side, anything else by its own name.
 *
 * Unchanged by the move to sub-folders, deliberately — a name a person has in a shared drive and
 * in an email thread is not ours to rename because the screen that produced it was reorganised.
 */
export const downloadName = (code: string, item: ApplicantFolderFileDto): string => {
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
export const save = async (fileId: string, name: string): Promise<boolean> => {
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

export const sizeOf = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A signed-link image, with a quiet placeholder until (or unless) it loads. */
export const Preview = ({
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

export const DownloadButton = ({
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

/** Saves one file and says so if it could not be saved. */
const useSaveOne = (): ((item: ApplicantFolderFileDto, code: string) => void) => {
  const t = useT();
  return (item, code) =>
    void save(item.file.id, downloadName(code, item)).then((done) => {
      if (!done) toast.error(t('hr.applicantFolders.downloadFailed'));
    });
};

export const CardTile = ({
  kind,
  item,
  code,
}: {
  kind: CardTileKind;
  item: ApplicantFolderFileDto | undefined;
  code: string;
}): JSX.Element => {
  const t = useT();
  const saveOne = useSaveOne();
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
            onClick={() => saveOne(item, code)}
          />
        )}
      </figcaption>
    </figure>
  );
};

export const FileRow = ({
  item,
  code,
}: {
  item: ApplicantFolderFileDto;
  code: string;
}): JSX.Element => {
  const t = useT();
  const saveOne = useSaveOne();
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
        onClick={() => saveOne(item, code)}
      />
    </li>
  );
};
