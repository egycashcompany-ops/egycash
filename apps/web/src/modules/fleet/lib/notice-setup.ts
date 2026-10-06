// A form's set-up applied to a notice — what a new notice starts with, and how one answer reaches
// every box it shares.
//
// «احط قيم افتراضيه … قيم بتتكرر فى اكتر من مكان زى كود العربيه و تواريخ معينه ف انا عاوز احدد دى
// برضو». Kept apart from the screens so the editor and the set-up page read one rule.
import { type FleetNoticeSettingsDto } from '@ecms/contracts';
import { type NoticeField, type NoticeTemplate } from './notice-templates';

const ISO_DAY = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u;
const SLASH_DAY = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/u;

/** Every box of a form, by its key. */
export const noticeFields = (template: NoticeTemplate): Map<string, NoticeField> =>
  new Map(
    template.sections.flatMap((section) => section.fields).map((field) => [field.key, field]),
  );

/**
 * A value written into a box of another kind: a date box keeps `2026-10-05` (what its picker
 * reads), a text box `2026/10/05` (how every Fleet table writes a day). Anything else as typed.
 */
export const valueFor = (field: NoticeField | undefined, value: string): string => {
  const text = value.trim();
  const iso = ISO_DAY.exec(text);
  const slash = SLASH_DAY.exec(text);
  const found = iso ?? slash;
  if (found === null) return value;
  const [, year = '', month = '', day = ''] = found;
  const mm = month.padStart(2, '0');
  const dd = day.padStart(2, '0');
  return field?.kind === 'date' ? `${year}-${mm}-${dd}` : `${year}/${mm}/${dd}`;
};

/** Today, the way a box of `field`'s kind holds a day. */
export const todayFor = (field: NoticeField | undefined, now: Date = new Date()): string => {
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return valueFor(field, `${y}-${m}-${d}`);
};

/** What a NEW notice starts with: every fixed default, and today in every «تاريخ اليوم» box. */
export const startingValues = (
  template: NoticeTemplate,
  settings: FleetNoticeSettingsDto | undefined,
  now: Date = new Date(),
): Record<string, string> => {
  if (settings === undefined) return {};
  const fields = noticeFields(template);
  const values: Record<string, string> = {};
  for (const [key, rule] of Object.entries(settings.defaults)) {
    const field = fields.get(key);
    if (field === undefined) continue;
    if (rule.mode === 'fixed' && rule.value.trim() !== '')
      values[key] = valueFor(field, rule.value);
    if (rule.mode === 'today') values[key] = todayFor(field, now);
  }
  // A box sharing an answer with a box that has one starts with it too.
  for (const link of settings.links) {
    const source = link.keys.find((key) => (values[key] ?? '') !== '');
    if (source === undefined) continue;
    for (const key of link.keys) {
      if ((values[key] ?? '') === '') values[key] = valueFor(fields.get(key), values[source] ?? '');
    }
  }
  return values;
};

/** The boxes «من السيستم» must leave alone — the ones set to be typed by hand every time. */
export const handTypedKeys = (settings: FleetNoticeSettingsDto | undefined): Set<string> =>
  new Set(
    Object.entries(settings?.defaults ?? {})
      .filter(([, rule]) => rule.mode === 'empty')
      .map(([key]) => key),
  );

/** The group a box belongs to, if any — its name and the other boxes in it. */
export const linkOf = (
  settings: FleetNoticeSettingsDto | undefined,
  key: string,
): { name: string; keys: string[] } | undefined =>
  settings?.links.find((link) => link.keys.includes(key));

/**
 * One answer typed into `key`, written into every box that shares it — each in its own kind's
 * form. The box typed in keeps exactly what was typed.
 */
export const withLinked = (
  template: NoticeTemplate,
  settings: FleetNoticeSettingsDto | undefined,
  values: Record<string, string>,
  key: string,
  value: string,
): Record<string, string> => {
  const next = { ...values, [key]: value };
  const link = linkOf(settings, key);
  if (link === undefined) return next;
  const fields = noticeFields(template);
  for (const other of link.keys) {
    if (other !== key && fields.has(other)) next[other] = valueFor(fields.get(other), value);
  }
  return next;
};

// ── «رقم الإخطار والتاريخ … يتحطه تلقائى» ──────────────────────────────────────────────────────

/** Where a form's number and date come from when its set-up has not chosen: its header boxes. */
const META_DEFAULTS: Record<string, { number: string; date: string }> = {
  misrInsurance: { number: 'accidentNo', date: 'reportDate' },
  deltaInsurance: { number: 'claimNo', date: 'reportDate' },
};

/** The boxes the notices table reads a notice's number and date from. */
export const metaFields = (
  template: NoticeTemplate,
  settings: Pick<FleetNoticeSettingsDto, 'numberField' | 'dateField'> | undefined,
): { number: string | null; date: string | null } => {
  const fallback = META_DEFAULTS[template.key];
  return {
    number: settings?.numberField ?? fallback?.number ?? null,
    date: settings?.dateField ?? fallback?.date ?? null,
  };
};

const ARABIC_DIGITS = /[٠-٩]/gu;
const DAY_FIRST = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/u;

/**
 * A day as a box holds it — `2026-10-05`, `2026/10/05`, `5/10/2026`, in either set of digits — as
 * `YYYY-MM-DD`, or `null` when the words are no day at all.
 */
export const parseNoticeDay = (text: string): string | null => {
  const plain = text.trim().replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660));
  const yearFirst = ISO_DAY.exec(plain) ?? SLASH_DAY.exec(plain);
  const dayFirst = DAY_FIRST.exec(plain);
  const [year, month, day] =
    yearFirst !== null
      ? [yearFirst[1], yearFirst[2], yearFirst[3]]
      : dayFirst !== null
        ? [dayFirst[3], dayFirst[2], dayFirst[1]]
        : [undefined, undefined, undefined];
  if (year === undefined || month === undefined || day === undefined) return null;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
};

/** A notice's number and date, read off its own boxes. */
export const noticeMeta = (
  template: NoticeTemplate,
  settings: Pick<FleetNoticeSettingsDto, 'numberField' | 'dateField'> | undefined,
  values: Record<string, string>,
): { noticeNumber: string | null; noticeDate: string | null } => {
  const from = metaFields(template, settings);
  const number = from.number === null ? '' : (values[from.number] ?? '').trim();
  return {
    noticeNumber: number === '' ? null : number,
    noticeDate: from.date === null ? null : parseNoticeDay(values[from.date] ?? ''),
  };
};
