// «فحص أجهزة السيارات» — the dashboard's rules, kept apart from the page because they are the part
// with a rule in it and the part a node test can reach. «فين الـ DashBoard؟ اللى بيظهر فيه التقرير
// والبيانات اللى الناس بتدخلها» — the owner saw the sample and answered «تمام نفذا الـ Dashboard بتاعت
// الفحص» (2026-11-10); this is what its filters mean, what each request asks, and how its words count.
//
// TWO READS, TWO SCOPES OF FILTER. The tiles, the bars and the overdue list are the SERVER's figures
// (`GET /it/vehicle-checks/dashboard`) under the period and the branch only — a count the page
// tallied from a page of rows would be a guess. The matrix is the same answer's `latest`, narrowed
// HERE by the car, «بها عطل» and the device, because those three narrow which rows are shown, not
// what the figures count. The reports list (`GET /it/vehicle-checks`) sends every filter.
//
// THE CAR. «السيارة» is what the reader types, matched anywhere in the code with the digits folded
// (Arabic-Indic and Latin read alike), as the server matches `carCode`. «كل تقارير هذه السيارة» on a
// report sets the car by its id as well (`vehicle`), because a code typed as text also matches every
// code that contains it — «1» would bring «10», «150» and «214» with it. Typing in the box drops the
// id: what the box says is then the filter. A car pinned by its id is EVERY report of that car: the
// reader opened one report and asked for the rest, so the list (and its files) set the period
// aside — a car last checked nine days ago under «آخر ٧ أيام» would otherwise list nothing,
// although its report was open a moment before — and the button clears «بها عطل» and the device.
import {
  IT_VEHICLE_CHECK_ITEMS,
  addDaysYmd,
  asciiDigits,
  cairoYmd,
  type ItVehicleCheckAnswer,
  type ItVehicleCheckItem,
  type ItVehicleCheckLatestDto,
  type Locale,
} from '@ecms/contracts';
import { formatBusinessDateTime, formatDate, formatNumber } from '../../../shared/lib/format';
import { detailKey } from '../../../shared/lib/query-keys';
import { custodyPlural, type CustodyCountForm } from '../../fleet/lib/custody-words';
import { type Translate } from './register-export';

// ── The filters ───────────────────────────────────────────────────────────────

/** «اليوم» · «آخر ٧ أيام» · «آخر ٣٠ يومًا» — Cairo days, today included, as the sample offers. */
export const VEHICLE_CHECK_PERIODS = ['today', '7', '30'] as const;
export type VehicleCheckPeriod = (typeof VEHICLE_CHECK_PERIODS)[number];

/** The sample opens on «آخر ٧ أيام» — the overdue rule's own week. It stays off the URL. */
export const DEFAULT_PERIOD: VehicleCheckPeriod = '7';

/** How many Cairo days each period spans, today included. */
const PERIOD_DAYS: Record<VehicleCheckPeriod, number> = { today: 1, '7': 7, '30': 30 };

/** The URL's `period`, or the default — an edited link is no period at all, not a refused page. */
export const readPeriod = (value: string | null): VehicleCheckPeriod =>
  (VEHICLE_CHECK_PERIODS as readonly string[]).includes(value ?? '')
    ? (value as VehicleCheckPeriod)
    : DEFAULT_PERIOD;

/** The URL's `device` — one of the eleven keys, or no device filter. */
export const readDevice = (value: string | null): ItVehicleCheckItem | null =>
  (IT_VEHICLE_CHECK_ITEMS as readonly string[]).includes(value ?? '')
    ? (value as ItVehicleCheckItem)
    : null;

/** The window a period covers, both ends included, ending today in Cairo. */
export const periodWindow = (
  period: VehicleCheckPeriod,
  today: string,
): { from: string; to: string } => ({
  from: addDaysYmd(today, -(PERIOD_DAYS[period] - 1)),
  to: today,
});

/** Today, in Cairo — the day the server reads «اليوم» as, whatever the browser's own zone. */
export const cairoToday = (now: Date = new Date()): string => cairoYmd(now);

/** What the page's URL says, read once. */
export interface VehicleCheckFilters {
  period: VehicleCheckPeriod;
  /** One branch id; '' for every branch the reader may see. */
  branchId: string;
  /** «السيارة» as typed; '' for none. */
  car: string;
  /** The car's id, set by «كل تقارير هذه السيارة»; '' for none. Wins over `car` when set. */
  vehicleId: string;
  /** «السيارات التي بها عطل فقط». */
  faults: boolean;
  /** One device «لا يعمل» — a bar of «الأعطال حسب الجهاز» pressed. */
  device: ItVehicleCheckItem | null;
}

/**
 * The invisible direction marks a code copied out of a chat or a sheet carries — exactly the ones
 * the server's `registerSearchPattern` (api it/shared/register-search.ts) drops, so the matrix and
 * the reports list agree on a «150» pasted with a U+200F before it.
 */
const DIRECTION_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;

/** «السيارة» as the server reads it: the direction marks dropped, the ends trimmed. */
export const carText = (typed: string): string => typed.replace(DIRECTION_MARKS, '').trim();

/**
 * Whether «مسح الفلاتر» has anything to clear. The period is not one of them: it says which days
 * the page is OF, as the sample has it, and the box always shows one.
 */
export const hasVehicleCheckFilters = (filters: VehicleCheckFilters): boolean =>
  filters.branchId !== '' ||
  carText(filters.car) !== '' ||
  filters.vehicleId !== '' ||
  filters.faults ||
  filters.device !== null;

/** A bar pressed: its device becomes the filter, or — pressed again — stops being it. */
export const toggleDevice = (
  current: ItVehicleCheckItem | null,
  item: ItVehicleCheckItem,
): ItVehicleCheckItem | null => (current === item ? null : item);

/** The schema's own bound on `carCode`: a longer text would be refused, not matched. */
const CAR_CODE_MAX = 50;

/** The dashboard's request — the period and the branch, nothing else. */
export const dashboardQuery = (
  filters: VehicleCheckFilters,
  today: string,
): { from: string; to: string; branchId?: string } => ({
  ...periodWindow(filters.period, today),
  ...(filters.branchId === '' ? {} : { branchId: filters.branchId }),
});

/** «آخر التقارير» — a page of cards, a grid of three on a wide screen. */
export const REPORTS_PAGE_SIZE = 12;

/** Whether «كل تقارير هذه السيارة» pinned a car by its id. */
export const carPinned = (filters: Pick<VehicleCheckFilters, 'vehicleId'>): boolean =>
  filters.vehicleId !== '';

/**
 * The days the reports list and its files cover: the period's — or `null`, every day, while a car
 * is pinned by its id. The tiles, the bars and the overdue list keep the period all the same.
 */
export const reportsWindow = (
  filters: Pick<VehicleCheckFilters, 'period' | 'vehicleId'>,
  today: string,
): { from: string; to: string } | null =>
  carPinned(filters) ? null : periodWindow(filters.period, today);

/**
 * «كل تقارير هذه السيارة» as a change of the URL: the car by its id and its code in the box, and
 * «بها عطل» and the device cleared — the reader asked for every report of THIS car, not for the
 * ones the other filters leave. The period stays in the URL for the figures; the list sets it
 * aside while the car is pinned (`reportsWindow`).
 */
export const carReportsPatch = (car: {
  vehicleId: string;
  vehicleCode: string;
}): Record<string, string | null> => ({
  car: car.vehicleCode,
  vehicle: car.vehicleId,
  faults: null,
  device: null,
});

/**
 * The reports list's request: every filter, the car by id when it was picked from a report — and
 * then no window at all (`reportsWindow`).
 */
export const reportsQuery = (
  filters: VehicleCheckFilters,
  today: string,
  page = 1,
  pageSize = REPORTS_PAGE_SIZE,
): {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  branchId?: string;
  vehicleId?: string;
  carCode?: string;
  faultsOnly?: boolean;
  device?: ItVehicleCheckItem;
} => {
  const car = carText(filters.car).slice(0, CAR_CODE_MAX);
  return {
    page,
    pageSize,
    ...(reportsWindow(filters, today) ?? {}),
    ...(filters.branchId === '' ? {} : { branchId: filters.branchId }),
    ...(filters.vehicleId !== ''
      ? { vehicleId: filters.vehicleId }
      : car === ''
        ? {}
        : { carCode: car }),
    ...(filters.faults ? { faultsOnly: true } : {}),
    ...(filters.device === null ? {} : { device: filters.device }),
  };
};

// ── The URL and the cache ──────────────────────────────────────────────────────

/**
 * The URL after a change of filters — `null` when it would read exactly as it does. A write that
 * changes nothing still navigates, and the car box (a debounced `SearchInput`) re-arms its timer on
 * every render it causes: «   » in the box re-navigated every 300 ms for as long as it stayed.
 * `resetPage`: any filter but the page itself starts the list again from its first page.
 */
export const patchedSearch = (
  current: URLSearchParams,
  updates: Record<string, string | null>,
  resetPage = true,
): URLSearchParams | null => {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  if (resetPage && !('page' in updates)) next.delete('page');
  return next.toString() === current.toString() ? null : next;
};

/**
 * The page to move to when the one asked for is past the last — `?page=2` once its only card was
 * deleted, or an old shared link — which showed «no report» with no pager to leave by. `null`
 * while in range; a list with nothing in it has no page to go to. The machines directory's rule
 * (atm/lib/machine-directory.ts `pageBeyondEnd`).
 */
export const reportsPageBeyondEnd = (
  page: number,
  meta: { totalItems: number; totalPages: number },
): number | null =>
  meta.totalItems > 0 && page > meta.totalPages ? Math.max(1, meta.totalPages) : null;

/**
 * After «حذف التقرير», which of the dashboard's reads are read again: every one but the deleted
 * report's own. Read again while its panel is still open, it answered 404 — a false «not found»
 * toast over a delete that had just succeeded.
 */
export const rereadAfterDelete = (queryKey: readonly unknown[], deletedId: string): boolean => {
  const own = detailKey('it', 'vehicleChecks', deletedId);
  return !(queryKey.length === own.length && own.every((part, i) => queryKey[i] === part));
};

/**
 * Whether the deleted report's own read can be let go: once the panel has closed or moved on, so
 * nothing on screen observes it any more — let go earlier, the open panel would fetch it again.
 */
export const forgetsDeletedReport = (deletedId: string | null, openId: string | null): boolean =>
  deletedId !== null && openId !== deletedId;

// ── A report's answers ─────────────────────────────────────────────────────────

type Items = Record<ItVehicleCheckItem, ItVehicleCheckAnswer | null>;

/** «يعمل» / «لا يعمل» / «لم يُفحص» — a device's state, `null` being the last. */
export type DeviceState = 'works' | 'notWorking' | 'unanswered';

export const deviceState = (answer: ItVehicleCheckAnswer | null | undefined): DeviceState =>
  answer === 'works' ? 'works' : answer === 'notWorking' ? 'notWorking' : 'unanswered';

/** How many devices a report has in each state. */
export const answerCounts = (items: Items): Record<DeviceState, number> => {
  const counts: Record<DeviceState, number> = { works: 0, notWorking: 0, unanswered: 0 };
  for (const item of IT_VEHICLE_CHECK_ITEMS) counts[deviceState(items[item])] += 1;
  return counts;
};

/** The devices «لا يعمل», in the owner's order. */
export const failedDevices = (items: Items): ItVehicleCheckItem[] =>
  IT_VEHICLE_CHECK_ITEMS.filter((item) => items[item] === 'notWorking');

/**
 * The car text against a code: anywhere in it, letter case ignored, any digit set read alike, the
 * direction marks of a pasted text dropped — the server's reading of `carCode`.
 */
export const carMatches = (code: string, typed: string): boolean => {
  const wanted = asciiDigits(carText(typed)).toLocaleLowerCase();
  return wanted === '' || asciiDigits(code).toLocaleLowerCase().includes(wanted);
};

/**
 * «حالة أجهزة كل سيارة — آخر تقرير» under the filters that choose ROWS: the car, «بها عطل» and the
 * device. The branch and the period are already the server's (the branch narrows `latest`; the
 * latest report is not limited by the window, by the contract's rule). Fleet's code order is kept.
 */
export const matrixRows = (
  latest: readonly ItVehicleCheckLatestDto[],
  filters: Pick<VehicleCheckFilters, 'car' | 'vehicleId' | 'faults' | 'device'>,
): ItVehicleCheckLatestDto[] =>
  latest.filter(
    (row) =>
      (filters.vehicleId !== ''
        ? row.vehicleId === filters.vehicleId
        : carMatches(row.vehicleCode, filters.car)) &&
      (!filters.faults || failedDevices(row.items).length > 0) &&
      (filters.device === null || row.items[filters.device] === 'notWorking'),
  );

/** One bar of «الأعطال حسب الجهاز»: its count, and its length against the longest. */
export interface FaultBar {
  item: ItVehicleCheckItem;
  count: number;
  /** 0–100, against the device with the most faults — so the bars compare with each other. */
  width: number;
}

export const faultBars = (faultsByDevice: Record<ItVehicleCheckItem, number>): FaultBar[] => {
  const max = Math.max(1, ...IT_VEHICLE_CHECK_ITEMS.map((item) => faultsByDevice[item] ?? 0));
  return IT_VEHICLE_CHECK_ITEMS.map((item) => {
    const count = faultsByDevice[item] ?? 0;
    return { item, count, width: Math.round((count * 100) / max) };
  });
};

// ── Words ─────────────────────────────────────────────────────────────────────

/** A camera's number, 1–8, from its key; `null` for the screen, the DVR and the radio. */
export const cameraNumber = (item: ItVehicleCheckItem): number | null => {
  const match = /^camera(\d)$/u.exec(item);
  return match === null ? null : Number(match[1]);
};

/** Arabic-Indic zero (U+0660); the other nine follow it. */
const AR_ZERO = 0x0660;

/** A text's ASCII digits in the reader's: Arabic-Indic in Arabic, untouched in English. */
const readerDigits = (text: string, locale: Locale): string =>
  locale === 'ar'
    ? text.replace(/[0-9]/gu, (digit) => String.fromCharCode(AR_ZERO + Number(digit)))
    : text;

/**
 * «كاميرا ٧ — داخل الخزينة ١» — the form's label, with the camera's number before it. The label is
 * the phone form's own, which writes «داخل الخزينة 1»; beside «كاميرا ٧» the two digit systems
 * read as a mistake, so in Arabic its digits are Arabic-Indic too, as the approved sample has it.
 */
export const deviceLabel = (t: Translate, locale: Locale, item: ItVehicleCheckItem): string => {
  const n = cameraNumber(item);
  const label = readerDigits(t(`it.vehicleCheck.item.${item}`), locale);
  return n === null
    ? label
    : t('it.vehicleChecks.cameraLabel', { n: formatNumber(n, locale), label });
};

/** «ك٧» — a column head of the matrix, the full label in its title. */
export const deviceShortLabel = (
  t: Translate,
  locale: Locale,
  item: ItVehicleCheckItem,
): string => {
  const n = cameraNumber(item);
  return n === null
    ? t(`it.vehicleChecks.short.${item}`)
    : t('it.vehicleChecks.cameraShort', { n: formatNumber(n, locale) });
};

/** «يعمل» / «لا يعمل» / «لم يُفحص». */
export const stateWord = (t: Translate, state: DeviceState): string =>
  state === 'unanswered' ? t('it.vehicleChecks.unanswered') : t(`it.vehicleCheck.answer.${state}`);

/**
 * A count in Arabic's five forms — «عطل واحد · عطلان · ٣ أعطال · ١١ عطلًا · ١٠٠ عطل» — the figure in
 * the reader's digits. `noun` names a key family `it.vehicleChecks.<noun>.<form>`.
 */
export const counted = (
  t: Translate,
  locale: Locale,
  noun: 'days' | 'faults' | 'reporters' | 'activeCars',
  n: number,
): string => {
  const form: CustodyCountForm = custodyPlural(locale, n);
  return t(`it.vehicleChecks.${noun}.${form}`, { count: formatNumber(n, locale) });
};

/** «بلا صور · صورة واحدة · صورتان · ٣ صور» — the form's own words for a report's photos. */
export const photoWords = (t: Translate, locale: Locale, n: number): string =>
  n === 0
    ? t('it.vehicleCheck.sent.photoCount.none')
    : t(`it.vehicleCheck.sent.photoCount.${custodyPlural(locale, n)}`, {
        count: formatNumber(n, locale),
      });

/**
 * A stored day, `YYYY-MM-DD`, in the reader's words. Read at local midnight: read as an instant it
 * is UTC midnight, which prints as the day before anywhere west of Greenwich.
 */
export const formatYmd = (day: string, locale: Locale): string =>
  formatDate(`${day}T00:00:00`, locale);

/** One formatter per locale: the reports list formats a time on every card. */
const cairoTimes = new Map<Locale, Intl.DateTimeFormat>();

/** The Cairo clock time of an instant — when a report was sent, as the reporter's phone saw it. */
export const cairoTime = (iso: string, locale: Locale): string => {
  let format = cairoTimes.get(locale);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      timeStyle: 'short',
      timeZone: 'Africa/Cairo',
    });
    cairoTimes.set(locale, format);
  }
  return format.format(new Date(iso));
};

/**
 * When a report was sent, beside the day it is for. Sent the same Cairo day, the time is enough;
 * filed later for an earlier day (the form allows it), the sending day is said too — a time beside
 * another day would read as that day's.
 */
export const sentWhen = (
  t: Translate,
  locale: Locale,
  report: { checkDate: string; createdAt: string },
): string =>
  cairoYmd(new Date(report.createdAt)) === report.checkDate
    ? cairoTime(report.createdAt, locale)
    : t('it.vehicleChecks.sentOn', { when: formatBusinessDateTime(report.createdAt, locale) });

/** A report's chip: its faults counted, or — none — whether every device was answered «يعمل». */
export const statusWords = (
  t: Translate,
  locale: Locale,
  items: Items,
): { text: string; tone: 'success' | 'danger' } => {
  const counts = answerCounts(items);
  if (counts.notWorking > 0) {
    return { text: counted(t, locale, 'faults', counts.notWorking), tone: 'danger' };
  }
  return {
    text:
      counts.unanswered === 0
        ? t('it.vehicleChecks.status.allWork')
        : t('it.vehicleChecks.status.noFaults'),
    tone: 'success',
  };
};

/** «لم تُفحص بعد», or «آخر فحص منذ ١١ يومًا». */
export const overdueWords = (
  t: Translate,
  locale: Locale,
  row: { lastCheckDate: string | null; daysSince: number | null },
): string =>
  row.lastCheckDate === null || row.daysSince === null
    ? t('it.vehicleChecks.overdue.never')
    : t('it.vehicleChecks.overdue.since', { days: counted(t, locale, 'days', row.daysSince) });

/**
 * The overdue panel with no car in it. «فُحصت كل السيارات النشطة» only when there is an active car
 * to have been checked: a reader who sees none is told that instead, not that all of none passed.
 */
export const overdueEmptyWords = (
  t: Translate,
  locale: Locale,
  dashboard: { overdueDays: number; totals: { activeCars: number } },
): string =>
  dashboard.totals.activeCars === 0
    ? t('it.vehicleChecks.tiles.noActiveCars')
    : t('it.vehicleChecks.overdue.empty', {
        days: counted(t, locale, 'days', dashboard.overdueDays),
      });

// ── The report's photos ─────────────────────────────────────────────────────────

/** One photo of an open report: its object URL once fetched, `null` if the fetch failed. */
export interface LoadedPhoto {
  fileId: string;
  url: string | null;
}

/**
 * Every photo of one report, fetched one after another through the authenticated reader of
 * `GET /it/vehicle-checks/:id/photos/:fileId` (a plain `<img src>` would carry no token), each made
 * an object URL. A photo that fails is `null` — the others still show. `onEach` hears each one as
 * it lands, so the first photo is on screen before the fifth is fetched. `isCancelled` stops the
 * walk when the report is closed mid-way; whatever was already made is still returned, so the
 * caller can revoke it.
 */
export const loadVehicleCheckPhotos = async (
  reportId: string,
  fileIds: readonly string[],
  {
    fetchPhoto,
    toUrl,
    onEach = () => undefined,
    isCancelled = () => false,
  }: {
    fetchPhoto: (reportId: string, fileId: string) => Promise<Blob>;
    toUrl: (blob: Blob) => string;
    onEach?: (photo: LoadedPhoto) => void;
    isCancelled?: () => boolean;
  },
): Promise<LoadedPhoto[]> => {
  const loaded: LoadedPhoto[] = [];
  for (const fileId of fileIds) {
    if (isCancelled()) break;
    let photo: LoadedPhoto;
    try {
      photo = { fileId, url: toUrl(await fetchPhoto(reportId, fileId)) };
    } catch {
      photo = { fileId, url: null };
    }
    loaded.push(photo);
    if (!isCancelled()) onEach(photo);
  }
  return loaded;
};
