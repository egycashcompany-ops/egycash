// `/` — the welcome page every account lands on.
//
// «عايز بقى أى حساب يدخل تظهرله Welcome Page بتقوله أهلاً وتاريخ ميلادة وكام يوم باقى عليه (ولو
// اليوم عيد ميلاده يقوله كل سنة وأنت طيب).. وتظهرله الـ Recent Pages اللى كان فيها».
//
// Three parts, each answering for itself:
//   • the greeting — every account: the person's photo (or initial), «أهلاً، …», today's date, and
//     where they sit when an employee stands behind the account;
//   • the birthday — only for an account linked to an employee: the date of birth, the days left,
//     and on the day itself the wish instead of the count;
//   • the recent pages — this account's own history in this browser, newest first, each a link.
//
// Dates are Cairo calendar days: the count turns over at Cairo midnight, wherever the device is.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cairoYmd, type Locale } from '@ecms/contracts';
import { useT } from '../localization/useT';
import { useAppSelector } from '../../store';
import { useMyApplications } from '../navigation/me-applications-queries';
import { flattenApps, moduleColor, type NavApp } from '../navigation/nav-model';
import { resolveNavIcon } from '../navigation/app-icon';
import { useNavPrefs, type RecentVisit } from '../navigation/NavPrefs';
import { PageContainer } from '../layout/PageContainer';
import { Card, CardHeader } from '../../shared/ui/Card';
import { Portrait } from '../../shared/ui/Portrait';
import { CakeIcon, FileIcon, HistoryIcon } from '../../shared/ui/icons';
import { pluralForm } from '../../shared/lib/plural';
import { cn } from '../../shared/lib/cn';
import { birthdayCountdown } from './birthday';
import { useMyEmployeeSummary, useMyPhotoUrl } from './home-api';

// Western digits, as everywhere in the app; Cairo's calendar, whatever the device's.
const intlLocale = (locale: Locale): string => (locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

const longDate = (ymd: string, locale: Locale, weekday: boolean): string =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    ...(weekday ? { weekday: 'long' as const } : {}),
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${ymd}T00:00:00Z`));

/** «منذ 5 دقائق», «أمس» — or nothing for a visit recorded before visits carried a time. */
const relativeTime = (at: number, now: number, locale: Locale): string | null => {
  if (at <= 0) return null;
  const seconds = Math.round((at - now) / 1000);
  const format = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'second');
};

const firstWord = (name: string): string => name.trim().split(/\s+/u)[0] ?? name;

// ── The greeting ─────────────────────────────────────────────────────────────

const Greeting = ({ birthdayToday }: { birthdayToday: boolean }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const me = useAppSelector((state) => state.auth.me);
  const summary = useMyEmployeeSummary().data ?? null;
  const photo = useMyPhotoUrl();

  const accountName = me === null ? '' : me.name.firstName[locale] || me.name.firstName.ar;
  const fullName =
    summary === null
      ? accountName
      : locale === 'en' && summary.fullNameEn !== null
        ? summary.fullNameEn
        : summary.fullNameAr;
  const name = summary === null ? accountName : firstWord(fullName);
  const placement =
    summary === null
      ? []
      : [summary.jobTitle, summary.department, summary.branch]
          .filter((part) => part !== null)
          .map((part) => part[locale] || part.ar);

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl p-6 text-white shadow-card sm:p-8',
        birthdayToday
          ? 'bg-gradient-to-br from-fuchsia-600 via-rose-500 to-amber-400'
          : 'bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-500',
      )}
    >
      {/* Light, not information: two soft circles behind the text. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -end-16 -top-20 h-64 w-64 rounded-full bg-white/10"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 end-40 h-48 w-48 rounded-full bg-white/5"
      />
      <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:text-start">
        <Portrait
          url={photo.url}
          name={fullName}
          size="xl"
          className="ring-4 ring-white/40 shadow-lg"
        />
        <div className="min-w-0">
          <p className="text-sm text-white/80">{longDate(cairoYmd(new Date()), locale, true)}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            {t(birthdayToday ? 'home.greetingBirthday' : 'home.greeting', { name })}
          </h1>
          {placement.length > 0 && (
            <p className="mt-2 text-sm text-white/85">{placement.join(' · ')}</p>
          )}
        </div>
      </div>
    </section>
  );
};

// ── The birthday ─────────────────────────────────────────────────────────────

const BirthdayCard = ({ birthDate }: { birthDate: string | null }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);

  if (birthDate === null) {
    return (
      <Card className="flex flex-col p-5">
        <CardTitle />
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          {t('home.birthday.notOnFile')}
        </p>
      </Card>
    );
  }

  const countdown = birthdayCountdown(birthDate, cairoYmd(new Date()));

  if (countdown.days === 0) {
    return (
      <Card className="relative flex flex-col overflow-hidden border-rose-200 bg-gradient-to-br from-rose-50 via-white to-amber-50 p-5 dark:border-rose-900 dark:from-rose-950/60 dark:via-slate-900 dark:to-amber-950/40">
        <Confetti />
        <CardTitle />
        <div className="relative my-auto py-6 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-rose-500 to-amber-400 text-white shadow-lg">
            <CakeIcon className="h-8 w-8" />
          </span>
          <p className="mt-4 text-2xl font-bold text-rose-700 dark:text-rose-300">
            {t('home.birthday.wish')}
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {t('home.birthday.wishLine')}
          </p>
        </div>
        <BornOn birthDate={birthDate} locale={locale} />
      </Card>
    );
  }

  // «غدًا» and «بعد غد» read better than a count; from three days on, the figure leads.
  const lead =
    countdown.days === 1
      ? { figure: null, text: t('home.birthday.tomorrow') }
      : countdown.days === 2
        ? { figure: null, text: t('home.birthday.dayAfter') }
        : {
            figure: String(countdown.days),
            text: t(`home.birthday.daysLeft.${pluralForm(locale, countdown.days)}`),
          };

  return (
    <Card className="flex flex-col p-5">
      <CardTitle />
      <div className="my-auto py-6 text-center">
        {lead.figure !== null && (
          <p className="text-6xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white">
            {lead.figure}
          </p>
        )}
        <p
          className={cn(
            'text-slate-600 dark:text-slate-300',
            lead.figure === null
              ? 'text-2xl font-bold text-rose-600 dark:text-rose-300'
              : 'mt-1 text-sm',
          )}
        >
          {lead.text}
        </p>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(countdown.progress * 100)}
        aria-label={t('home.birthday.progress')}
      >
        <div
          className="h-full rounded-full bg-gradient-to-l from-rose-500 to-amber-400"
          style={{ width: `${Math.max(4, Math.round(countdown.progress * 100))}%` }}
        />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">
            {t('home.birthday.bornOn')}
          </dt>
          <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">
            {longDate(birthDate.slice(0, 10), locale, false)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">{t('home.birthday.next')}</dt>
          <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">
            {longDate(countdown.next, locale, true)}
          </dd>
        </div>
      </dl>
    </Card>
  );
};

const CardTitle = (): JSX.Element => {
  const t = useT();
  return (
    <h2 className="relative flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300">
        <CakeIcon className="h-5 w-5" />
      </span>
      {t('home.birthday.title')}
    </h2>
  );
};

const BornOn = ({ birthDate, locale }: { birthDate: string; locale: Locale }): JSX.Element => {
  const t = useT();
  return (
    <p className="relative text-center text-xs text-slate-500 dark:text-slate-400">
      {t('home.birthday.bornOn')}: {longDate(birthDate.slice(0, 10), locale, false)}
    </p>
  );
};

/** Paper confetti for the day itself — drawn, so it needs no image and no emoji font. */
const Confetti = (): JSX.Element => (
  <span aria-hidden="true" className="pointer-events-none absolute inset-0">
    {[
      ['start-[12%] top-[18%] bg-rose-400', 'rotate-12'],
      ['start-[78%] top-[14%] bg-amber-400', '-rotate-12'],
      ['start-[88%] top-[46%] bg-sky-400', 'rotate-45'],
      ['start-[8%] top-[58%] bg-emerald-400', '-rotate-45'],
      ['start-[24%] top-[84%] bg-fuchsia-400', 'rotate-12'],
      ['start-[70%] top-[80%] bg-indigo-400', '-rotate-12'],
    ].map(([place, turn]) => (
      <span key={place} className={cn('absolute h-3 w-1.5 rounded-sm opacity-70', place, turn)} />
    ))}
  </span>
);

// ── The recent pages ─────────────────────────────────────────────────────────

const RecentPagesCard = ({
  className,
  wide = false,
}: {
  className?: string;
  wide?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const { recentVisits } = useNavPrefs();
  const applications = useMyApplications();
  const now = Date.now();

  // Only pages this account can still open: a page whose access was removed drops out.
  const visits = useMemo(() => {
    const apps = flattenApps(applications.data ?? []);
    return recentVisits
      .map((visit) => ({ visit, app: apps.find((a) => a.id === visit.id) }))
      .filter((entry): entry is { visit: RecentVisit; app: NavApp } => entry.app !== undefined);
  }, [applications.data, recentVisits]);

  // Signed in, and holding nothing: a new account whose access has not been set up yet.
  if (applications.data !== undefined && flattenApps(applications.data).length === 0) {
    return (
      <Card className={cn('px-5 py-10 text-center', className)}>
        <p className="font-semibold text-slate-800 dark:text-slate-100">
          {t('platform.landing.nothingGrantedTitle')}
        </p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {t('platform.landing.nothingGrantedBody')}
        </p>
      </Card>
    );
  }

  return (
    <Card className={cn(className)}>
      <CardHeader title={t('home.recent.title')} />
      {visits.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
          <HistoryIcon className="h-8 w-8 text-slate-300 dark:text-slate-600" />
          {t('home.recent.empty')}
        </div>
      ) : (
        <ul className={cn('grid gap-1 p-3 sm:grid-cols-2', wide && 'lg:grid-cols-3')}>
          {visits.map(({ visit, app }) => {
            const Icon = resolveNavIcon(app.icon, FileIcon);
            const when = relativeTime(visit.at, now, locale);
            return (
              <li key={app.id}>
                <Link
                  to={app.route}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span
                    className={cn(
                      'grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white',
                      moduleColor(app.moduleId),
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800 group-hover:text-brand-700 dark:text-slate-100 dark:group-hover:text-brand-300">
                      {app.name[locale] || app.name.ar}
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {app.moduleName[locale] || app.moduleName.ar}
                      {when !== null && ` · ${when}`}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};

// ── The page ─────────────────────────────────────────────────────────────────

export const WelcomePage = (): JSX.Element => {
  const summary = useMyEmployeeSummary();
  const employee = summary.data ?? null;
  const birthdayToday =
    employee?.birthDate != null &&
    birthdayCountdown(employee.birthDate, cairoYmd(new Date())).days === 0;

  return (
    <PageContainer>
      <div className="space-y-6">
        <Greeting birthdayToday={birthdayToday} />
        {employee === null ? (
          // No employee behind the account: nothing personal to show, so the history takes the row.
          <RecentPagesCard wide />
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <BirthdayCard birthDate={employee.birthDate} />
            <RecentPagesCard className="lg:col-span-2" />
          </div>
        )}
      </div>
    </PageContainer>
  );
};
