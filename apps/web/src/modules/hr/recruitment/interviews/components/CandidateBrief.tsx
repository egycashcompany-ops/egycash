// The interviewer's quick read on the candidate: who they are, where they live, what they studied,
// what they have done, and their papers (CV, ID card, everything filed) — one glance before and
// during the interview, so the questions come from the file rather than from memory.
//
// Read-only on purpose. Editing the candidate stays on their own page; this is the briefing.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { type ApplicantDto, type FileDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { cn } from '../../../../../shared/lib/cn';
import { formatDate, governorateLabel } from '../../../../../shared/lib/format';
import { Portrait } from '../../../../../shared/ui/Portrait';
import { Spinner } from '../../../../../shared/ui/Spinner';
import {
  BriefcaseIcon,
  CakeIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  ImageIcon,
  PhoneIcon,
  PinIcon,
  BadgeIcon,
} from '../../../../../shared/ui/icons';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { fetchBlob } from '../../../../../shared/lib/api-client';
import { useApplicantAttachments } from '../../applicants/api/applicant-queries';
import { fileDownloadTicket } from '../../applicants/api/applicant-api';
import { cardSideOf } from '../../applicants/components/NationalIdCardPanel';

/** Whole years since the birth date, or null. */
export const ageOf = (iso: string | null): number | null => {
  if (iso === null) return null;
  const born = new Date(iso);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getUTCFullYear();
  if (
    now.getMonth() < born.getUTCMonth() ||
    (now.getMonth() === born.getUTCMonth() && now.getDate() < born.getUTCDate())
  ) {
    age -= 1;
  }
  return age >= 0 ? age : null;
};

/**
 * A file's bytes as an in-memory URL, fetched once with the signed-in session.
 *
 * Not a signed link: an `<img src>` cannot carry the bearer token, and a protected file (an
 * applicant's papers) refuses a link without one. Fetching through the API with the token works
 * for every file the viewer may read; the object URL is released when the file changes or the
 * component goes away.
 */
export const useFileUrl = (fileId: string | null): string | null => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setUrl(null);
    if (fileId === null) return;
    void fetchBlob(`/platform/files/${fileId}/download`)
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

/** Open a file the viewer may read: its bytes with the session, shown in a new tab. */
export const openFileBytes = async (fileId: string): Promise<string> =>
  URL.createObjectURL(await fetchBlob(`/platform/files/${fileId}/download`));

const isCv = (f: FileDto): boolean => /\b(cv|resume|résumé)\b|سيرة/i.test(`${f.displayName} ${f.originalName}`);

const Fact = ({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }): JSX.Element => (
  <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-brand-600 shadow-sm dark:bg-slate-900 dark:text-brand-300">
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="mt-0.5 block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</span>
    </span>
  </div>
);

const Section = ({ title, children }: { title: string; children: ReactNode }): JSX.Element => (
  <section className="space-y-3">
    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
    {children}
  </section>
);

/** A document row: hover an image to see it, click to open, download beside it. */
const DocumentRow = ({ file, label, badge }: { file: FileDto; label: string; badge?: string }): JSX.Element => {
  const t = useT();
  const [hover, setHover] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const image = file.mime.startsWith('image/');

  const ticket = async (): Promise<string | null> => {
    if (url !== null) return url;
    try {
      const fresh = (await fileDownloadTicket(file.id)).url;
      setUrl(fresh);
      return fresh;
    } catch {
      toast.error(t('applicants.attachments.downloadFailed'));
      return null;
    }
  };

  return (
    <li
      className="relative flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 transition-colors hover:border-brand-200 hover:bg-brand-50/40 dark:border-slate-800 dark:hover:border-brand-800 dark:hover:bg-brand-950/30"
      onMouseEnter={() => {
        setHover(true);
        if (image) void ticket();
      }}
      onMouseLeave={() => setHover(false)}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
        {image ? <ImageIcon className="h-4 w-4" /> : <FileIcon className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{label}</span>
        {badge !== undefined && (
          <span className="mt-0.5 inline-block rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200">
            {badge}
          </span>
        )}
      </span>
      <button
        type="button"
        className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-brand-600 dark:hover:bg-slate-900"
        aria-label={t('interviews.brief.open')}
        onClick={() => void ticket().then((u) => u !== null && window.open(u, '_blank', 'noopener'))}
      >
        <ExternalLinkIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-brand-600 dark:hover:bg-slate-900"
        aria-label={t('common.download')}
        onClick={() =>
          void fileDownloadTicket(file.id)
            .then((tk) => window.open(tk.url, '_blank', 'noopener'))
            .catch(() => toast.error(t('applicants.attachments.downloadFailed')))
        }
      >
        <DownloadIcon className="h-4 w-4" />
      </button>
      {image && hover && (
        <div className="pointer-events-none absolute bottom-full end-0 z-30 mb-2 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          {url === null ? (
            <div className="grid aspect-[1.586] place-items-center">
              <Spinner />
            </div>
          ) : (
            <img src={url} alt={label} className="w-full rounded-lg object-contain" />
          )}
        </div>
      )}
    </li>
  );
};

export const CandidateHero = ({
  applicant,
  fallbackName,
  aside,
}: {
  applicant: ApplicantDto | undefined;
  fallbackName: string;
  /** Status / stage badges drawn on the hero. */
  aside?: ReactNode;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: files = [] } = useApplicantAttachments(applicant?.id ?? '');
  const portraitFile = files.find((f) => cardSideOf(f) === 'portrait') ?? null;
  // The face cut from their ID card first (always a real photo), then any photo uploaded by hand.
  const photoUrl = useFileUrl(portraitFile?.id ?? applicant?.photoFileId ?? null);

  const name = applicant?.fullNameAr ?? fallbackName;
  const age = ageOf(applicant?.birthDate ?? null);
  const address = applicant?.currentAddress ?? applicant?.officialAddress ?? null;
  const where = address === null
    ? null
    : [address.city, governorateLabel(address.governorate, locale)].filter((v) => v !== '' && v !== '—').join('، ');

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-500 p-5 text-white shadow-lg sm:p-6">
      <div aria-hidden className="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 start-1/3 h-48 w-48 rounded-full bg-indigo-300/20 blur-2xl" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
        <Portrait url={photoUrl} name={name} size="xl" className="ring-4 ring-white/30" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">{aside}</div>
          <h2 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{name}</h2>
          {applicant?.fullNameEn !== null && applicant?.fullNameEn !== undefined && (
            <p className="truncate text-sm text-white/75" dir="ltr">{applicant.fullNameEn}</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1 text-xs font-medium">
            {age !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 backdrop-blur">
                <CakeIcon className="h-3.5 w-3.5" /> {t('interviews.brief.years', { n: age })}
              </span>
            )}
            {applicant?.education != null && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 backdrop-blur">
                <BadgeIcon className="h-3.5 w-3.5" /> {t(`applicants.education.${applicant.education.level}`)}
              </span>
            )}
            {where !== null && where !== '' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 backdrop-blur">
                <PinIcon className="h-3.5 w-3.5" /> {where}
              </span>
            )}
            {applicant !== undefined && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 backdrop-blur" dir="ltr">
                <PhoneIcon className="h-3.5 w-3.5" /> {applicant.contact.primaryPhone}
              </span>
            )}
          </div>
        </div>
        {applicant !== undefined && (
          <Link
            to={`/applicants/${applicant.id}`}
            className="inline-flex items-center gap-1.5 self-start rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold backdrop-blur transition hover:bg-white/25"
          >
            {t('interviews.brief.fullFile')} <ExternalLinkIcon className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
};

export const CandidateBrief = ({ applicant }: { applicant: ApplicantDto | undefined }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: files = [], isLoading } = useApplicantAttachments(applicant?.id ?? '');

  if (applicant === undefined) {
    return (
      <div className="grid place-items-center rounded-2xl border border-slate-200 bg-white p-10 dark:border-slate-800 dark:bg-slate-900">
        <Spinner />
      </div>
    );
  }

  const address = applicant.currentAddress ?? applicant.officialAddress;
  const addressText =
    address === null
      ? '—'
      : [address.line1, address.city, governorateLabel(address.governorate, locale)]
          .filter((v) => v !== '' && v !== '—')
          .join('، ') || '—';
  const age = ageOf(applicant.birthDate);
  const edu = applicant.education;

  // CV first, then the ID card, then the rest — the order an interviewer reaches for them.
  const docs = [...files].sort((a, b) => {
    const rank = (f: FileDto): number => (isCv(f) ? 0 : cardSideOf(f) !== null ? 1 : 2);
    return rank(a) - rank(b);
  });
  const docLabel = (f: FileDto): string => {
    const side = cardSideOf(f);
    if (side !== null) return `${t('applicants.idCard.card')} — ${t(`applicants.idCard.side.${side}`)}`;
    return f.displayName;
  };

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
      <Section title={t('interviews.brief.personal')}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Fact icon={<CakeIcon className="h-4 w-4" />} label={t('interviews.brief.age')} value={
            age === null ? '—' : `${t('interviews.brief.years', { n: age })} · ${formatDate(applicant.birthDate, locale)}`
          } />
          <Fact icon={<PhoneIcon className="h-4 w-4" />} label={t('applicants.form.primaryPhone')} value={
            <span dir="ltr">{applicant.contact.primaryPhone}</span>
          } />
          <Fact icon={<PinIcon className="h-4 w-4" />} label={t('interviews.brief.address')} value={addressText} />
          <Fact
            icon={<BadgeIcon className="h-4 w-4" />}
            label={t('interviews.brief.status')}
            value={[
              applicant.gender === null ? null : t(`applicants.gender.${applicant.gender}`),
              applicant.maritalStatus === null ? null : t(`applicants.marital.${applicant.maritalStatus}`),
              applicant.military === null ? null : t(`applicants.military.${applicant.military.status}`),
            ]
              .filter((v): v is string => v !== null)
              .join(' · ') || '—'}
          />
        </div>
      </Section>

      <Section title={t('interviews.brief.education')}>
        {edu === null ? (
          <p className="text-sm text-slate-400">—</p>
        ) : (
          <div className="rounded-xl border border-slate-100 p-4 dark:border-slate-800">
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {t(`applicants.education.${edu.level}`)}
              {edu.specialization !== undefined && <span className="font-normal text-slate-500"> — {edu.specialization}</span>}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {[edu.institution, edu.graduationYear, edu.grade].filter((v) => v !== undefined && v !== '').join(' · ') || ' '}
            </p>
          </div>
        )}
      </Section>

      <Section title={t('interviews.brief.experience')}>
        {applicant.experience.length === 0 ? (
          <p className="text-sm text-slate-400">{t('interviews.brief.noExperience')}</p>
        ) : (
          <ol className="relative space-y-3 border-s-2 border-brand-100 ps-5 dark:border-brand-900">
            {applicant.experience.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -start-[27px] top-1 grid h-4 w-4 place-items-center rounded-full bg-brand-500 ring-4 ring-white dark:ring-slate-900">
                  <BriefcaseIcon className="h-2.5 w-2.5 text-white" />
                </span>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {e.position ?? '—'} <span className="font-normal text-slate-500">· {e.employer}</span>
                </p>
                <p className="text-xs text-slate-400">
                  {[formatDate(e.from ?? null, locale), formatDate(e.to ?? null, locale)].join(' → ')}
                  {e.leavingReason !== undefined && ` · ${e.leavingReason}`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={t('interviews.brief.documents')}>
        {isLoading ? (
          <Spinner />
        ) : docs.length === 0 ? (
          <p className="text-sm text-slate-400">{t('interviews.brief.noDocuments')}</p>
        ) : (
          <ul className="space-y-2">
            {docs.map((f) => (
              <DocumentRow
                key={f.id}
                file={f}
                label={docLabel(f)}
                {...(isCv(f) ? { badge: t('interviews.brief.cv') } : {})}
              />
            ))}
          </ul>
        )}
      </Section>

      {(applicant.expectedSalary !== null || applicant.formAnswers.length > 0) && (
        <Section title={t('interviews.brief.more')}>
          <dl className={cn('grid grid-cols-1 gap-2 text-sm sm:grid-cols-2')}>
            {applicant.expectedSalary !== null && (
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <dt className="text-xs text-slate-400">{t('applicants.form.expectedSalary')}</dt>
                <dd className="font-semibold text-slate-800 dark:text-slate-100">
                  {applicant.expectedSalary.amount.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')} {applicant.expectedSalary.currency}
                </dd>
              </div>
            )}
            {applicant.formAnswers.map((a) => (
              <div key={a.key} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <dt className="text-xs text-slate-400">{a.label[locale]}</dt>
                <dd className="font-semibold text-slate-800 dark:text-slate-100">{a.value === 'true' ? '✓' : a.value === 'false' ? '✗' : a.value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
    </div>
  );
};
