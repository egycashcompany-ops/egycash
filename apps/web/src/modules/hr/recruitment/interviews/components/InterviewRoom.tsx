// «غرفة المقابلة» — the interview page, in the app's own palette (white cards, slate, brand).
//
// The character comes from layout and type, not from new colours: a Cairo display name with a
// soft brand marker stroke, the candidate's photo as a slightly tilted print, a spec strip of
// facts, a numbered «ask about» index, and the papers laid out like sheets on a desk.
//
//   RoomHero        name, photo, status + live clock, and the two quick actions.
//   FactBento       a ruled spec strip — age, education, status, home.
//   AskAbout        questions drawn from the candidate's own file, as a numbered index.
//   ExperienceTrail where they have worked, as dated rows.
//   DocumentWall    CV, ID card and every paper; images open in a lightbox.
//
// Every value is read from the applicant record; nothing here invents a fact.
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/cairo/900.css';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { type ApplicantDto, type FileDto, type InterviewDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { cn } from '../../../../../shared/lib/cn';
import { formatDate, governorateLabel, localized } from '../../../../../shared/lib/format';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { initialOf } from '../../../../../shared/ui/Portrait';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { DownloadIcon, ExternalLinkIcon, FileIcon, PhoneIcon, StarIcon } from '../../../../../shared/ui/icons';
import { useApplicantAttachments } from '../../applicants/api/applicant-queries';
import { useApplicantDocumentSet } from '../../applicant-documents/api/applicant-document-queries';
import { cardSideOf } from '../../applicants/components/NationalIdCardPanel';
import { ageOf, openFileBytes, useFileUrl } from './CandidateBrief';
import { InterviewStatusBadge } from './InterviewStatusBadge';

// ── Shared kit — used by the scorecard, the quick decision and the page ──────────────────────

/** Display type: Cairo, heavy. */
export const DISPLAY = 'font-[Cairo,system-ui,sans-serif]';
/** The app's card. */
export const SHEET = 'rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900';
/** Small spaced label. */
export const EYEBROW = 'text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400';
/** A section title. */
const TITLE = cn(DISPLAY, 'text-xl font-extrabold text-slate-900 dark:text-slate-50');

const isCv = (f: FileDto): boolean => /\b(cv|resume|résumé)\b|سيرة/i.test(`${f.displayName} ${f.originalName}`);
const LOW_EDUCATION = new Set(['none', 'primary', 'preparatory']);

const homeOf = (a: ApplicantDto | undefined, locale: Locale): string | null => {
  const addr = a?.currentAddress ?? a?.officialAddress ?? null;
  if (addr === null) return null;
  const parts = [addr.city, governorateLabel(addr.governorate, locale)].filter((v) => v !== '' && v !== '—');
  return parts.length === 0 ? (addr.line1 === '' ? null : addr.line1) : parts.join('، ');
};

const yearOf = (d: string | null | undefined): string => (d == null || d === '' ? '…' : String(new Date(d).getFullYear()));

// ── Live clock ───────────────────────────────────────────────────────────────

const useElapsed = (since: string | null, running: boolean): string | null => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  if (since === null) return null;
  const secs = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/** Running: one chip — a pulsing dot, «in progress» and the time since it started. Otherwise the plain status badge. */
const StatusLine = ({ interview: iv }: { interview: InterviewDto }): JSX.Element => {
  const t = useT();
  const live = iv.status === 'inProgress';
  const elapsed = useElapsed(iv.startedAt, live);
  if (!live) return <InterviewStatusBadge status={iv.status} outcome={iv.outcome} />;
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-900">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-600" />
      </span>
      {t('interviews.status.inProgress')}
      {elapsed !== null && (
        <span className="border-s border-brand-200 ps-2 font-figures tabular-nums dark:border-brand-800" dir="ltr">
          {elapsed}
        </span>
      )}
    </span>
  );
};

// ── Hero ─────────────────────────────────────────────────────────────────────

export const RoomHero = ({
  interview: iv,
  applicant,
}: {
  interview: InterviewDto;
  applicant: ApplicantDto | undefined;
}): JSX.Element => {
  const t = useT();
  const { data: files = [] } = useApplicantAttachments(applicant?.id ?? '');
  const portrait = files.find((f) => cardSideOf(f) === 'portrait') ?? null;
  const photo = useFileUrl(portrait?.id ?? applicant?.photoFileId ?? null);
  const [photoFailed, setPhotoFailed] = useState(false);

  const ratings = iv.panel.map((p) => p.rating).filter((r): r is number => r !== null);
  const avg = ratings.length === 0 ? null : ratings.reduce((a, b) => a + b, 0) / ratings.length;
  const name = applicant?.fullNameAr ?? iv.applicantName;
  const role = [applicant?.placementLabel.position ?? null, applicant?.placementLabel.branch ?? null].filter(
    (v): v is string => v !== null && v !== '',
  );

  return (
    <section className={cn(SHEET, 'relative overflow-hidden')}>
      {/* A thin brand rule along the top edge — the only decoration. */}
      <div aria-hidden className="h-1 bg-brand-600" />
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
        {/* The photo as a print, slightly tilted. */}
        <figure className="relative mx-auto w-28 shrink-0 -rotate-2 bg-white p-1.5 pb-2 shadow-elevated ring-1 ring-slate-200 transition-transform duration-300 hover:rotate-0 sm:mx-0 dark:bg-slate-800 dark:ring-slate-700">
          <div className="aspect-[4/5] overflow-hidden bg-slate-100 dark:bg-slate-700">
            {photo !== null && !photoFailed ? (
              <img src={photo} alt={name} onError={() => setPhotoFailed(true)} className="h-full w-full object-cover" />
            ) : (
              <span className={cn(DISPLAY, 'grid h-full w-full place-items-center text-4xl font-black text-brand-600/70 dark:text-brand-300/70')}>
                {initialOf(name)}
              </span>
            )}
          </div>
          {avg !== null && (
            <span className="absolute -bottom-2.5 start-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-slate-900 shadow rtl:translate-x-1/2">
              <StarIcon className="h-3 w-3 fill-slate-900" /> {avg.toFixed(1)}
            </span>
          )}
        </figure>

        <div className="min-w-0 flex-1 text-center sm:text-start">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <StatusLine interview={iv} />
            {role.length > 0 && <span className="text-xs font-semibold text-slate-500">{role.join(' — ')}</span>}
          </div>
          <h2 className={cn(DISPLAY, 'mt-3 text-3xl font-black leading-snug text-slate-900 sm:text-4xl dark:text-slate-50')}>
            <span className="box-decoration-clone bg-[linear-gradient(transparent_62%,rgb(var(--brand-200))_62%,rgb(var(--brand-200))_92%,transparent_92%)] px-1 dark:bg-[linear-gradient(transparent_62%,rgb(var(--brand-800)/0.7)_62%,rgb(var(--brand-800)/0.7)_92%,transparent_92%)]">
              {name}
            </span>
          </h2>
          {applicant?.fullNameEn != null && applicant.fullNameEn !== '' && (
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              <span dir="ltr">{applicant.fullNameEn}</span>
            </p>
          )}
        </div>

        {applicant !== undefined && (
          <div className="flex flex-wrap justify-center gap-2 sm:flex-col sm:items-stretch">
            <Link
              to={`/applicants/${applicant.id}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              {t('interviews.brief.fullFile')} <ExternalLinkIcon className="h-4 w-4" />
            </Link>
            <a
              href={`tel:${applicant.contact.primaryPhone}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold tabular-nums text-slate-700 transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:text-slate-200"
              dir="ltr"
            >
              <PhoneIcon className="h-4 w-4" /> {applicant.contact.primaryPhone}
            </a>
          </div>
        )}
      </div>
    </section>
  );
};

// ── Spec strip ───────────────────────────────────────────────────────────────

const Cell = ({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }): JSX.Element => (
  <div className={cn('bg-white p-4 dark:bg-slate-900', className)}>
    <p className={EYEBROW}>{label}</p>
    <div className={cn(DISPLAY, 'mt-1.5 text-lg font-extrabold leading-snug text-slate-900 dark:text-slate-50')}>{value}</div>
    {sub !== undefined && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
  </div>
);

export const FactBento = ({ applicant }: { applicant: ApplicantDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const age = ageOf(applicant.birthDate);
  const edu = applicant.education;
  const addr = applicant.currentAddress ?? applicant.officialAddress;
  const status = [
    applicant.gender === null ? null : t(`applicants.gender.${applicant.gender}`),
    applicant.maritalStatus === null ? null : t(`applicants.marital.${applicant.maritalStatus}`),
  ].filter((v): v is string => v !== null);

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 shadow-card md:grid-cols-6 dark:border-slate-800 dark:bg-slate-800">
      <Cell
        label={t('interviews.brief.age')}
        value={
          age === null ? '—' : (
            <span className="text-4xl font-black leading-none text-brand-600 dark:text-brand-400">
              {age}
              <span className="ms-1 text-sm font-bold text-slate-400">{t('interviews.room.yrs')}</span>
            </span>
          )
        }
        sub={formatDate(applicant.birthDate, locale)}
      />
      <Cell
        className="md:col-span-2"
        label={t('interviews.brief.education')}
        value={edu === null ? '—' : t(`applicants.education.${edu.level}`)}
        sub={edu === null ? undefined : [edu.specialization, edu.institution, edu.graduationYear].filter((v) => v !== undefined && v !== '').join(' · ') || undefined}
      />
      <Cell
        label={t('interviews.brief.status')}
        value={<span className="text-base">{status.join(' · ') || '—'}</span>}
        sub={applicant.military === null ? undefined : t(`applicants.military.${applicant.military.status}`)}
      />
      <Cell
        className="col-span-2"
        label={t('interviews.brief.address')}
        // The full address — on online applications it is the one read off the National ID card.
        value={
          <span className="text-base leading-snug">
            {addr !== null && addr.line1 !== '' ? addr.line1 : (homeOf(applicant, locale) ?? '—')}
          </span>
        }
        sub={addr !== null && addr.line1 !== '' ? (homeOf(applicant, locale) ?? undefined) : undefined}
      />
    </div>
  );
};

// ── Ask about ────────────────────────────────────────────────────────────────

/** Questions the file itself raises — deterministic, from the record, never guessed. */
const questionsFor = (
  a: ApplicantDto,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: Locale,
): string[] => {
  const q: string[] = [];
  const last = a.experience[0];
  if (a.experience.length === 0) q.push(t('interviews.ask.noExperience'));
  else if (last !== undefined) {
    q.push(t('interviews.ask.lastRole', { position: last.position ?? '—', employer: last.employer }));
    if (last.leavingReason !== undefined && last.leavingReason !== '') q.push(t('interviews.ask.leaving', { employer: last.employer }));
  }
  if (a.education !== null) {
    if (LOW_EDUCATION.has(a.education.level)) q.push(t('interviews.ask.skills'));
    else if (a.education.specialization !== undefined) q.push(t('interviews.ask.specialization', { spec: a.education.specialization }));
  }
  const home = homeOf(a, locale);
  if (home !== null && a.placementLabel.branch !== null) q.push(t('interviews.ask.commute', { home, branch: a.placementLabel.branch }));
  if (a.military !== null && (a.military.status === 'postponed' || a.military.status === 'serving')) q.push(t('interviews.ask.military'));
  if (a.expectedSalary !== null) q.push(t('interviews.ask.salary', { amount: a.expectedSalary.amount.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US') }));
  if (!a.willingToShiftWork) q.push(t('interviews.ask.shifts'));
  q.push(t('interviews.ask.whyUs'));
  return q.slice(0, 6);
};

export const AskAbout = ({ applicant }: { applicant: ApplicantDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [done, setDone] = useState<Set<number>>(new Set());
  const questions = questionsFor(applicant, t, locale);
  const progress = questions.length === 0 ? 0 : (done.size / questions.length) * 100;
  return (
    <section className={cn(SHEET, 'p-5')}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className={TITLE}>{t('interviews.ask.title')}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{t('interviews.ask.subtitle')}</p>
        </div>
        <p className="font-figures text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100" dir="ltr">
          {done.size}<span className="text-slate-300 dark:text-slate-600">/{questions.length}</span>
        </p>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${progress}%` }} />
      </div>
      <ol className="mt-2">
        {questions.map((q, i) => {
          const asked = done.has(i);
          return (
            <li key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
              <button
                type="button"
                onClick={() =>
                  setDone((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
                className="group flex w-full items-center gap-3 py-3 text-start"
              >
                <span
                  className={cn(
                    DISPLAY,
                    'grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black tabular-nums transition',
                    asked
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-500 group-hover:bg-brand-50 group-hover:text-brand-700 dark:bg-slate-800 dark:text-slate-400',
                  )}
                >
                  {asked ? '✓' : String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className={cn(
                    'text-sm font-medium leading-relaxed transition',
                    asked ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200',
                  )}
                >
                  {q}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

// ── Experience ───────────────────────────────────────────────────────────────

export const ExperienceTrail = ({ applicant }: { applicant: ApplicantDto }): JSX.Element => {
  const t = useT();
  return (
    <section className={cn(SHEET, 'p-5')}>
      <h3 className={TITLE}>{t('interviews.brief.experience')}</h3>
      {applicant.experience.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400 dark:border-slate-700">
          {t('interviews.brief.noExperience')}
        </p>
      ) : (
        <ol className="mt-2">
          {applicant.experience.map((e, i) => (
            <li key={i} className="grid grid-cols-[auto_1fr] gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800">
              <span className="mt-0.5 rounded-md bg-brand-50 px-2 py-0.5 font-figures text-[11px] font-semibold tabular-nums text-brand-700 dark:bg-brand-950/50 dark:text-brand-300" dir="ltr">
                {yearOf(e.from)}–{yearOf(e.to)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{e.position ?? '—'}</p>
                <p className="text-sm text-slate-500">{e.employer}</p>
                {e.leavingReason !== undefined && e.leavingReason !== '' && (
                  <p className="mt-0.5 text-xs text-slate-400">↳ {e.leavingReason}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

// ── Documents ────────────────────────────────────────────────────────────────

const TILT = ['-rotate-1', 'rotate-1', '-rotate-[0.5deg]', 'rotate-[1.5deg]'];

const DocTile = ({
  file,
  label,
  cv,
  tilt,
  onOpen,
}: {
  /** Only what the tile reads — a folder paper is shown the same way as an attachment. */
  file: Pick<FileDto, 'id' | 'mime' | 'extension'>;
  label: string;
  cv: boolean;
  tilt: string;
  onOpen: (url: string, label: string, image: boolean) => void;
}): JSX.Element => {
  const t = useT();
  const image = file.mime.startsWith('image/');
  const thumb = useFileUrl(image ? file.id : null);
  const open = (): void => {
    void openFileBytes(file.id)
      .then((url) => onOpen(url, label, image))
      .catch(() => toast.error(t('applicants.attachments.downloadFailed')));
  };
  return (
    <div
      className={cn(
        'group relative rounded-xl bg-white p-1.5 shadow-card ring-1 ring-slate-200 transition duration-300 hover:-translate-y-1 hover:rotate-0 hover:shadow-elevated dark:bg-slate-800 dark:ring-slate-700',
        cv && 'ring-2 ring-brand-500',
        tilt,
      )}
    >
      {cv && (
        <span className="absolute -top-2.5 start-3 z-10 rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-bold text-white shadow">
          {t('interviews.brief.cv')}
        </span>
      )}
      <button type="button" onClick={open} className="block w-full text-start">
        <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-900">
          {image ? (
            thumb === null ? (
              <Spinner />
            ) : (
              <img src={thumb} alt={label} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
            )
          ) : (
            <span className="flex flex-col items-center gap-1.5 text-slate-400">
              <FileIcon className="h-9 w-9" />
              <span className="font-figures text-[11px] font-semibold uppercase">{file.extension.replace(/^\./, '') || 'file'}</span>
            </span>
          )}
        </div>
        <p className="truncate px-1 pb-0.5 pt-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</p>
      </button>
      <button
        type="button"
        aria-label={t('common.download')}
        onClick={() =>
          void openFileBytes(file.id)
            .then((url) => window.open(url, '_blank', 'noopener'))
            .catch(() => toast.error(t('applicants.attachments.downloadFailed')))
        }
        className="absolute end-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-slate-700 opacity-0 shadow transition group-hover:opacity-100 focus:opacity-100 dark:bg-slate-900/95 dark:text-slate-200"
      >
        <DownloadIcon className="h-4 w-4" />
      </button>
    </div>
  );
};

/** One thing on the wall: an attachment on the applicant, or a paper in their document folder. */
interface WallItem {
  key: string;
  file: Pick<FileDto, 'id' | 'mime' | 'extension'>;
  label: string;
  cv: boolean;
  rank: number;
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.bmp']);
const extOf = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
};

export const DocumentWall = ({ applicantId }: { applicantId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: files = [], isLoading } = useApplicantAttachments(applicantId);
  // The papers the candidate handed in — the application page and the portal both file them here.
  const { data: folder, isLoading: folderLoading } = useApplicantDocumentSet(applicantId);
  const [viewing, setViewing] = useState<{ url: string; label: string } | null>(null);

  const labelOf = (f: FileDto): string => {
    const side = cardSideOf(f);
    return side === null ? f.displayName : `${t('applicants.idCard.card')} — ${t(`applicants.idCard.side.${side}`)}`;
  };
  // CV first, then the ID card, then the folder papers in their catalogue order, then the rest.
  const docs: WallItem[] = [
    ...files.map((f) => ({
      key: f.id,
      file: f,
      label: labelOf(f),
      cv: isCv(f),
      rank: isCv(f) ? 0 : cardSideOf(f) !== null ? 1 : 3,
    })),
    ...(folder?.documents ?? [])
      .filter((d) => !files.some((f) => f.id === d.fileId))
      .map((d) => {
        const extension = extOf(d.fileName);
        return {
          key: d.fileId,
          file: {
            id: d.fileId,
            extension,
            mime: IMAGE_EXT.has(extension) ? 'image/jpeg' : extension === '.pdf' ? 'application/pdf' : 'application/octet-stream',
          },
          label:
            d.status === 'pending' ? `${localized(d.typeName, locale)} · ${t('interviews.brief.pendingReview')}` : localized(d.typeName, locale),
          cv: false,
          rank: 2,
        };
      }),
  ].sort((a, b) => a.rank - b.rank);
  const loading = isLoading || folderLoading;

  return (
    <section className={cn(SHEET, 'p-5')}>
      <div className="mb-5 flex items-center gap-2">
        <h3 className={TITLE}>{t('interviews.brief.documents')}</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500 dark:bg-slate-800">{docs.length}</span>
      </div>
      {loading ? (
        <div className="grid place-items-center py-8"><Spinner /></div>
      ) : docs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400 dark:border-slate-700">
          {t('interviews.brief.noDocuments')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {docs.map((d, i) => (
            <DocTile
              key={d.key}
              file={d.file}
              label={d.label}
              cv={d.cv}
              tilt={TILT[i % TILT.length] ?? ''}
              onOpen={(url, label, image) => (image ? setViewing({ url, label }) : window.open(url, '_blank', 'noopener'))}
            />
          ))}
        </div>
      )}
      <Dialog open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.label ?? ''} size="lg">
        {viewing !== null && <img src={viewing.url} alt={viewing.label} className="max-h-[70vh] w-full rounded-xl object-contain" />}
      </Dialog>
    </section>
  );
};
