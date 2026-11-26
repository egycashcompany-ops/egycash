// An ID-card icon that shows the applicant's National-ID card while it is hovered.
//
// Used in queue tables («المرفقات» on the security check), where a whole panel would not fit. The
// card is only fetched on the first hover, and it is the LATEST version of each side — so an HR
// rotate / crop is what shows here too. The preview is positioned against the viewport so a table
// cell's overflow cannot clip it.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type FileDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { IdCardIcon } from '../../../../../shared/ui/icons';
import { fetchBlob } from '../../../../../shared/lib/api-client';
import { detailKey } from '../../../../../shared/lib/query-keys';
import { listApplicantAttachments } from '../api/applicant-api';
import { cardSideOf } from './NationalIdCardPanel';

const PREVIEW_WIDTH = 288;

/** One side's image, fetched with the session while the preview is open. */
const SideImage = ({ file, alt }: { file: FileDto; alt: string }): JSX.Element => {
  const [url, setUrl] = useState<string | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    void fetchBlob(`/platform/files/${file.id}/download`)
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
  }, [file.id]);
  if (url === null) {
    return (
      <span className="grid aspect-[1.586] place-items-center">
        <Spinner />
      </span>
    );
  }
  if (url === 'failed') return <span className="block aspect-[1.586] rounded-lg bg-slate-100 dark:bg-slate-800" />;
  return <img src={url} alt={alt} className="mx-auto block max-h-44 w-full rounded-lg object-contain" />;
};

export const IdCardHoverIcon = ({ applicantId, name }: { applicantId: string; name: string }): JSX.Element => {
  const t = useT();
  const anchor = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [asked, setAsked] = useState(false);
  const { data: files, isLoading } = useQuery({
    queryKey: [...detailKey('hr', 'applicants', applicantId), 'attachments'],
    queryFn: () => listApplicantAttachments(applicantId),
    enabled: asked && applicantId !== '',
  });

  const sides = (files ?? [])
    .map((f) => ({ file: f, side: cardSideOf(f) }))
    .filter((c) => c.side === 'front' || c.side === 'back')
    .sort((a, b) => (a.side === 'front' ? 0 : 1) - (b.side === 'front' ? 0 : 1));

  const show = (): void => {
    setAsked(true);
    const rect = anchor.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - PREVIEW_WIDTH / 2), window.innerWidth - PREVIEW_WIDTH - 8);
    // Below the icon, or above it when the row is near the bottom of the window.
    const below = rect.bottom + 8;
    setAt({ top: below + 380 > window.innerHeight ? Math.max(8, rect.top - 388) : below, left });
  };

  return (
    <span
      ref={anchor}
      className="inline-flex cursor-zoom-in rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-800"
      tabIndex={0}
      aria-label={`${t('applicants.idCard.title')} — ${name}`}
      onMouseEnter={show}
      onMouseLeave={() => setAt(null)}
      onFocus={show}
      onBlur={() => setAt(null)}
      onClick={(e) => e.stopPropagation()}
    >
      <IdCardIcon className="h-5 w-5" />
      {at !== null && (
        <span
          className="pointer-events-none fixed z-50 block space-y-1.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          style={{ top: at.top, left: at.left, width: PREVIEW_WIDTH }}
        >
          {isLoading || files === undefined ? (
            <span className="grid aspect-[1.586] place-items-center">
              <Spinner />
            </span>
          ) : sides.length === 0 ? (
            <span className="block p-4 text-center text-xs text-slate-500">{t('applicants.idCard.none')}</span>
          ) : (
            sides.map(({ file, side }) => (
              <SideImage key={file.id} file={file} alt={`${name} — ${t(`applicants.idCard.side.${side ?? 'front'}`)}`} />
            ))
          )}
        </span>
      )}
    </span>
  );
};
