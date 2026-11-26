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
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  NATIONAL_ID_CARD_SIDES,
  nationalIdCardTag,
  type ApplicantDto,
  type FileDto,
  type NationalIdCardHistoryDto,
  type NationalIdCardSide,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { DownloadIcon, EditIcon, EyeIcon, HistoryIcon, UploadIcon } from '../../../../../shared/ui/icons';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { formatDateTime } from '../../../../../shared/lib/format';
import { detailKey } from '../../../../../shared/lib/query-keys';
import { useApplicantAttachments } from '../api/applicant-queries';
import { fileDownloadTicket } from '../api/applicant-api';
import { cardHistory, restoreCard } from '../../applicant-documents/api/applicant-document-api';
import { IdCardEditorDialog } from './IdCardEditorDialog';
import { ReplaceCardInput } from './card-replace';
import { VersionThumb } from './VersionThumb';

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

  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ file: FileDto; side: NationalIdCardSide } | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  /** The history version being looked at before restoring it. */
  const [viewing, setViewing] = useState<{ side: NationalIdCardSide; fileId: string; label: string; isCurrent: boolean } | null>(null);

  const cards = files
    .map((f) => ({ file: f, side: cardSideOf(f) }))
    .filter((c): c is { file: FileDto; side: NationalIdCardSide } => c.side !== null)
    .sort((a, b) => ORDER[a.side] - ORDER[b.side]);

  // Each filed side's version history — who edited it, when, and what was done.
  const histories = useQueries({
    queries: cards.map(({ side }) => ({
      queryKey: ['hr', 'idCardHistory', applicant.id, side],
      queryFn: () => cardHistory(applicant.id, side),
    })),
  });
  const history: NationalIdCardHistoryDto[] = histories
    .map((h) => h.data)
    .filter((h): h is NationalIdCardHistoryDto => h !== undefined && h.versions.length > 1);

  const restore = async (side: NationalIdCardSide, fileId: string): Promise<void> => {
    setRestoring(fileId);
    try {
      await restoreCard(applicant.id, side, fileId);
      await qc.invalidateQueries({ queryKey: detailKey('hr', 'applicants', applicant.id) });
      await qc.invalidateQueries({ queryKey: ['hr', 'idCardHistory', applicant.id] });
      setUrls({});
      toast.success(t('applicants.idCard.history.restored'));
    } catch {
      toast.error(t('applicants.idCard.edit.failed'));
    } finally {
      setRestoring(null);
    }
  };

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
                  <Can permission="applicantDocument.review">
                    <ReplaceCardInput
                      applicantId={applicant.id}
                      side={side}
                      onDone={() => setUrls({})}
                      trigger={(pick, busy) => (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy}
                          onClick={pick}
                          aria-label={`${t('applicants.idCard.replace.open')} — ${nameOf(side)}`}
                          title={t('applicants.idCard.replace.open')}
                        >
                          <UploadIcon className="h-4 w-4" />
                        </Button>
                      )}
                    />
                  </Can>
                  <Can permission="applicantDocument.review">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing({ file, side })}
                      aria-label={`${t('applicants.idCard.edit.open')} — ${nameOf(side)}`}
                      title={t('applicants.idCard.edit.open')}
                    >
                      <EditIcon className="h-4 w-4" />
                    </Button>
                  </Can>
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

        {history.length > 0 && (
          // The edit history, under the images: every version of each side, newest first.
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <HistoryIcon className="h-4 w-4" />
              {t('applicants.idCard.history.title')}
            </h4>
            <div className="space-y-3">
              {history.map((h) => (
                <div key={h.side}>
                  <p className="mb-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                    {t(`applicants.idCard.side.${h.side}`)}
                  </p>
                  <ol className="space-y-1">
                    {h.versions.map((v) => (
                      <li
                        key={v.fileId}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800/60"
                      >
                        <VersionThumb
                          fileId={v.fileId}
                          alt={`v${v.fileVersion}`}
                          onOpen={() =>
                            setViewing({
                              side: h.side,
                              fileId: v.fileId,
                              isCurrent: v.isCurrent,
                              label: `${t(`applicants.idCard.side.${h.side}`)} — v${v.fileVersion} · ${v.fileVersion === 1 ? t('applicants.idCard.history.original') : (v.note ?? '')}`,
                            })
                          }
                        />
                        <span className="font-mono text-slate-400">v{v.fileVersion}</span>
                        <span className="font-medium text-slate-800 dark:text-slate-100">
                          {v.fileVersion === 1 ? t('applicants.idCard.history.original') : (v.note ?? '—')}
                        </span>
                        <span className="text-slate-500">
                          {t('applicants.idCard.history.by', { name: v.byName ?? t('applicants.idCard.history.unknown') })}
                        </span>
                        <span className="text-slate-400" dir="ltr">
                          {formatDateTime(v.at, locale)}
                        </span>
                        <span className="ms-auto">
                          {v.isCurrent ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                              {t('applicants.idCard.history.current')}
                            </span>
                          ) : (
                            <Can permission="applicantDocument.review">
                              <Button
                                size="sm"
                                variant="ghost-brand"
                                loading={restoring === v.fileId}
                                onClick={() => void restore(h.side, v.fileId)}
                              >
                                {t('applicants.idCard.history.restore')}
                              </Button>
                            </Can>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardBody>
      <Dialog
        open={viewing !== null}
        onClose={() => setViewing(null)}
        size="lg"
        title={viewing?.label ?? ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setViewing(null)}>
              {t('common.close')}
            </Button>
            {viewing !== null && !viewing.isCurrent && (
              <Can permission="applicantDocument.review">
                <Button
                  loading={restoring === viewing.fileId}
                  onClick={() => {
                    const v = viewing;
                    void restore(v.side, v.fileId).then(() => setViewing(null));
                  }}
                >
                  {t('applicants.idCard.history.restore')}
                </Button>
              </Can>
            )}
          </>
        }
      >
        {viewing !== null && <VersionThumb fileId={viewing.fileId} alt={viewing.label} large />}
      </Dialog>
      <IdCardEditorDialog
        open={editing !== null}
        onClose={() => {
          setEditing(null);
          setUrls({});
        }}
        applicantId={applicant.id}
        file={editing?.file ?? null}
        side={editing?.side ?? null}
        title={editing === null ? '' : `${t('applicants.idCard.edit.open')} — ${nameOf(editing.side)}`}
      />
    </Card>
  );
};
