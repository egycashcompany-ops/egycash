// The pieces a folder's files are drawn with: a signed-link preview, a download button, a card
// tile and a file row. One module, because the sub-folders and the shelf both reach for them and
// neither owns them.
import {
  type ApplicantFolderFileDto,
  type ApplicantFolderFileKind,
  type FileDto,
} from '@ecms/contracts';
import { useEffect, useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { fetchBlob } from '../../../../../shared/lib/api-client';
import { cn } from '../../../../../shared/lib/cn';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { DownloadIcon, FileIcon, ImageIcon } from '../../../../../shared/ui/icons';
import { type CardTileKind } from './applicant-folder-groups';
import { PickFileButton, RemoveButton, useFolderEdit } from './folder-edit';

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

/**
 * A file's bytes, fetched WITH the signed-in session. A signed link cannot be used here: an
 * applicant's papers are protected files, and a link loaded by `<img>` or a bare `fetch` carries no
 * token, so the server refuses it.
 */
const bytesOf = (fileId: string): Promise<Blob> => fetchBlob(`/platform/files/${fileId}/download`);

/** Saves one file under `name`. */
export const save = async (fileId: string, name: string): Promise<boolean> => {
  try {
    const href = URL.createObjectURL(await bytesOf(fileId));
    const link = document.createElement('a');
    link.href = href;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    return true;
  } catch {
    return false;
  }
};

/** Opens a file full size in a new tab. */
export const openFull = async (fileId: string): Promise<boolean> => {
  try {
    const href = URL.createObjectURL(await bytesOf(fileId));
    window.open(href, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return true;
  } catch {
    return false;
  }
};

/** An in-memory URL for a file's bytes, released when the file changes or the view goes away. */
const useObjectUrl = (fileId: string | null): string | null => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setUrl(null);
    if (fileId === null) return;
    void bytesOf(fileId)
      .then((blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [fileId]);
  return url;
};

export const sizeOf = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** The image itself, with a quiet placeholder until (or unless) it loads. */
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
  const url = useObjectUrl(fileId);
  return url !== null ? (
    <img
      src={url}
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
  const edit = useFolderEdit();
  const side = kind === 'cardFront' ? 'front' : kind === 'cardBack' ? 'back' : 'portrait';
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
        <span className="flex flex-wrap items-center gap-2">
          {edit?.canEdit === true && (
            <PickFileButton
              primary={item === undefined}
              label={item === undefined ? t('applicantFile.upload') : t('applicantFile.replace')}
              onPick={(file) => edit.putCard(side, file)}
            />
          )}
          {item !== undefined && (
            <DownloadButton
              label={t('hr.applicantFolders.download')}
              onClick={() => saveOne(item, code)}
            />
          )}
        </span>
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
  const edit = useFolderEdit();
  // A handed-in paper can be swapped for a clearer copy, or taken out.
  const typeId = item.kind === 'document' ? edit?.typeIdOf(item.file.id) : undefined;
  const image = item.file.mime.startsWith('image/');
  return (
    <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
      <button
        type="button"
        title={t('hr.applicantFolders.openFull')}
        onClick={() =>
          void openFull(item.file.id).then((done) => {
            if (!done) toast.error(t('hr.applicantFolders.downloadFailed'));
          })
        }
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-500 ring-1 ring-slate-200 transition hover:ring-brand-400 dark:bg-slate-800 dark:ring-slate-700',
          image ? 'h-20 w-28' : 'h-12 w-12',
        )}
      >
        {image ? (
          <Preview fileId={item.file.id} alt={item.file.displayName} />
        ) : (
          <FileIcon className="h-5 w-5" />
        )}
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
          {item.file.displayName}
        </span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">
          {t(`hr.applicantFolders.kind.${item.kind}`)} · {sizeOf(item.file.size)}
        </span>
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {typeId !== undefined && edit?.canEdit === true && (
          <PickFileButton label={t('applicantFile.replace')} onPick={(file) => edit.putDoc(typeId, file)} />
        )}
        {item.kind === 'attachment' && edit?.canAttach === true && (
          <RemoveButton onClick={() => edit.askRemoveAttachment(item.file.id, item.file.displayName)} />
        )}
        {typeId !== undefined && edit?.canRemove === true && (
          <RemoveButton onClick={() => edit.askRemove(typeId, item.file.displayName)} />
        )}
        <DownloadButton
          label={t('hr.applicantFolders.download')}
          onClick={() => saveOne(item, code)}
        />
      </span>
    </li>
  );
};
