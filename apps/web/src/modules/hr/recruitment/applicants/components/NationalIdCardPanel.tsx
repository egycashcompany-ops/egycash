// The applicant's National-ID card images — front, back and the holder's photo — on their file.
//
// Each image is named by the PERSON, in the language the site is in: «محمد أحمد — بطاقة الرقم
// القومي (الوجه)» in Arabic, «Mohamed Ahmed — National ID (front)» in English (falling back to
// the Arabic name when no English one is recorded). Hovering a row previews the image; the
// download button saves it under that same name.
//
// The images are found by their TAG (`national-id-front|back|portrait`), not their name, so a
// card filed before this panel existed shows here too.
import { useState } from 'react';
import {
  NATIONAL_ID_CARD_SIDES,
  nationalIdCardTag,
  type ApplicantDto,
  type FileDto,
  type NationalIdCardSide,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { DownloadIcon, EyeIcon } from '../../../../../shared/ui/icons';
import { useApplicantAttachments } from '../api/applicant-queries';
import { fileDownloadTicket } from '../api/applicant-api';

/** Which side a filed image shows, read from its tag. */
export const cardSideOf = (f: FileDto): NationalIdCardSide | null =>
  NATIONAL_ID_CARD_SIDES.find((side) => f.tags.includes(nationalIdCardTag(side))) ?? null;

const ORDER: Record<NationalIdCardSide, number> = { front: 0, back: 1, portrait: 2 };

export const NationalIdCardPanel = ({ applicant }: { applicant: ApplicantDto }): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const { data: files = [], isLoading } = useApplicantAttachments(applicant.id);
  // A signed URL per image, fetched on first hover and kept while the page is open.
  const [urls, setUrls] = useState<Record<string, string | 'loading' | 'failed'>>({});
  const [hovered, setHovered] = useState<string | null>(null);

  const cards = files
    .map((f) => ({ file: f, side: cardSideOf(f) }))
    .filter((c): c is { file: FileDto; side: NationalIdCardSide } => c.side !== null)
    .sort((a, b) => ORDER[a.side] - ORDER[b.side]);

  if (!isLoading && cards.length === 0) return null;

  const personName =
    locale === 'en' && applicant.fullNameEn !== null && applicant.fullNameEn.trim() !== ''
      ? applicant.fullNameEn
      : applicant.fullNameAr;
  const nameOf = (side: NationalIdCardSide): string =>
    `${personName} — ${t('applicants.idCard.card')} (${t(`applicants.idCard.side.${side}`)})`;

  const urlFor = async (f: FileDto): Promise<string> => {
    const cached = urls[f.id];
    if (cached !== undefined && cached !== 'loading' && cached !== 'failed') return cached;
    setUrls((prev) => ({ ...prev, [f.id]: 'loading' }));
    try {
      const ticket = await fileDownloadTicket(f.id);
      setUrls((prev) => ({ ...prev, [f.id]: ticket.url }));
      return ticket.url;
    } catch (error) {
      setUrls((prev) => ({ ...prev, [f.id]: 'failed' }));
      throw error;
    }
  };

  const preview = (f: FileDto): void => {
    setHovered(f.id);
    if (urls[f.id] === undefined) void urlFor(f).catch(() => undefined);
  };

  const download = async (f: FileDto, side: NationalIdCardSide): Promise<void> => {
    try {
      // A fresh ticket: a cached one may have expired.
      const ticket = await fileDownloadTicket(f.id);
      try {
        const blob = await fetch(ticket.url).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.blob();
        });
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = `${nameOf(side)}.${f.extension.replace(/^\./, '') || 'jpg'}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10_000);
      } catch {
        // The store may not allow a script to read it; the browser can still open it directly.
        window.open(ticket.url, '_blank', 'noopener');
      }
    } catch {
      toast.error(t('applicants.attachments.downloadFailed'));
    }
  };

  return (
    <Card>
      <CardHeader title={t('applicants.idCard.title')} />
      <CardBody>
        {isLoading ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {cards.map(({ file, side }) => {
              const url = urls[file.id];
              return (
                <li
                  key={file.id}
                  className="relative flex items-center gap-3 py-2 text-sm"
                  onMouseEnter={() => preview(file)}
                  onMouseLeave={() => setHovered((h) => (h === file.id ? null : h))}
                  onFocus={() => preview(file)}
                  onBlur={() => setHovered((h) => (h === file.id ? null : h))}
                >
                  <EyeIcon className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 cursor-zoom-in truncate font-medium text-slate-800 dark:text-slate-100" tabIndex={0}>
                    {nameOf(side)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void download(file, side)}
                    aria-label={t('common.download')}
                  >
                    <DownloadIcon className="h-4 w-4" />
                  </Button>
                  {hovered === file.id && (
                    // The preview: anchored to the row, drawn above everything below it.
                    <div className="pointer-events-none absolute bottom-full end-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                      {url === undefined || url === 'loading' ? (
                        <div className="grid aspect-[1.586] place-items-center">
                          <Spinner />
                        </div>
                      ) : url === 'failed' ? (
                        <p className="p-4 text-center text-xs text-slate-500">{t('applicants.idCard.previewFailed')}</p>
                      ) : (
                        <img src={url} alt={nameOf(side)} className="w-full rounded-lg object-contain" />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
};
