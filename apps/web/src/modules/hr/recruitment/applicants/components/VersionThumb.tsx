// One version of a card image — a small thumbnail in the history, or the large view in the preview
// dialog — so HR sees a version before restoring it. Fetched with the signed-in session, so an
// older version (not the one on the card now) shows as well as the current one.
import { useEffect, useState } from 'react';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { fetchBlob } from '../../../../../shared/lib/api-client';

export const VersionThumb = ({
  fileId,
  alt,
  large = false,
  onOpen,
}: {
  fileId: string;
  alt: string;
  large?: boolean;
  onOpen?: () => void;
}): JSX.Element => {
  const [url, setUrl] = useState<string | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setUrl(null);
    void fetchBlob(`/platform/files/${fileId}/download`)
      .then((blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => live && setUrl('failed'));
    return () => {
      live = false;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [fileId]);

  if (large) {
    return (
      <div className="grid min-h-48 place-items-center rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
        {url === null ? (
          <Spinner />
        ) : url === 'failed' ? (
          <span className="text-sm text-slate-500">—</span>
        ) : (
          <img src={url} alt={alt} className="max-h-[60vh] max-w-full rounded-md object-contain" />
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-white hover:ring-2 hover:ring-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-700 dark:bg-slate-900"
      aria-label={alt}
      title={alt}
    >
      {url === null ? (
        <Spinner />
      ) : url === 'failed' ? (
        <span className="text-[10px] text-slate-400">—</span>
      ) : (
        <img src={url} alt="" className="h-full w-full object-contain" />
      )}
    </button>
  );
};
