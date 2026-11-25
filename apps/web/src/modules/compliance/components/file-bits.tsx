// The pieces the Compliance files are drawn with: a folder's picture through an object URL, the
// labelled action button a file row carries, and opening or saving a file's bytes. The module's own
// copies of what HR's shelf draws (`folder-file-bits.tsx` there), as the folder drawing is — and
// every byte comes from the module's own endpoints, which count each opening and download.
import { type ComplianceAccessAction } from '@ecms/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../../../shared/lib/cn';
import { documentBlob, folderCoverBlob } from '../api/compliance-api';

/** A file's size as a person reads it: «1.4 MB», «320 KB». */
export const sizeOf = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Opens a file in a new tab — a PDF the browser shows itself. Counted as one opening. */
export const openDocument = async (id: string): Promise<boolean> => {
  // The tab is opened BEFORE the bytes arrive: a tab opened after an `await` is a pop-up the
  // browser blocks, because it no longer follows the click.
  const tab = window.open('', '_blank');
  try {
    const href = URL.createObjectURL(await documentBlob(id, 'view'));
    if (tab === null) {
      window.open(href, '_blank', 'noopener');
    } else {
      tab.location.href = href;
    }
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return true;
  } catch {
    tab?.close();
    return false;
  }
};

/**
 * Saves a file under its own name. Counted as one download. The object URL is released a moment
 * AFTER the click, as the reference's `save` does: released at once, a browser may start the
 * download after the URL is gone and save it as «download», without its name.
 */
export const downloadDocument = async (id: string, fileName: string): Promise<boolean> => {
  try {
    const href = URL.createObjectURL(
      await documentBlob(id, 'download' satisfies ComplianceAccessAction),
    );
    const link = document.createElement('a');
    link.href = href;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    return true;
  } catch {
    return false;
  }
};

/** The folder's picture as an object URL, released when it changes or the view goes away. */
const useCoverUrl = (folderId: string, version: string | null): string | null => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setUrl(null);
    if (version === null) return;
    void folderCoverBlob(folderId, version)
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
  }, [folderId, version]);
  return url;
};

/** The picture itself, or `fallback` until (or unless) it loads. */
export const FolderCover = ({
  folderId,
  version,
  alt,
  fallback,
  className,
}: {
  folderId: string;
  version: string | null;
  alt: string;
  fallback: ReactNode;
  className?: string;
}): JSX.Element => {
  const url = useCoverUrl(folderId, version);
  return url !== null ? (
    <img src={url} alt={alt} className={cn('h-full w-full object-cover', className)} />
  ) : (
    <>{fallback}</>
  );
};

/** A file row's labelled action — HR's `DownloadButton` look, for every action a row offers. */
export const RowButton = ({
  onClick,
  label,
  icon,
  tone = 'default',
  busy = false,
}: {
  onClick: () => void;
  label: string;
  icon: ReactNode;
  tone?: 'default' | 'danger';
  busy?: boolean;
}): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className={cn(
      'inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border bg-white px-2.5 text-xs font-semibold transition-colors disabled:opacity-60 dark:bg-slate-900',
      tone === 'danger'
        ? 'border-slate-200 text-red-600 hover:border-red-300 hover:bg-red-50 dark:border-slate-700 dark:text-red-400 dark:hover:border-red-800 dark:hover:bg-red-950/40'
        : 'border-slate-200 text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:bg-brand-950/40 dark:hover:text-brand-200',
    )}
  >
    {icon}
    {label}
  </button>
);
