// Which vehicles the daily board is showing, and what colour each counter wears.
//
// THE COUNTERS ARE NOT ONE AXIS, and that is the whole reason this module exists rather than a
// `filter` inline on the page. Six chips sit above the board and they answer three different
// questions:
//
//   • «إجمالي»  — every vehicle on the day. Not a filter at all; the absence of one.
//   • «صيانة»   — `inMaintenance`: an open maintenance visit covers this DATE (FR-5). A STATE.
//   • «تشغيل»   — the vehicle carries a plan: a mission, or a driver in either seat. A STATE.
//   • the rest  — one per active mission type from the catalog. A CATEGORY, matched by id.
//
// So they overlap and they do not sum to «إجمالي»: a car in the workshop may still carry a
// mission, and every car carrying one is counted under «تشغيل» too. Treating all six as values of
// a single "category" field would have produced a filter that is quietly wrong — and there is a
// mission type literally named «نقل أموال (صيانة)», which is a different thing from the «صيانة»
// state beside it. The two words are not the same filter and must never collapse into one.
//
// WHICH IS WHY THE URL CARRIES TWO KEYS. A mission chip writes the `mission` parameter the
// existing dropdown already owns, so the chip and the dropdown are one control on one axis and
// there is no second copy of mission filtering anywhere. `view` carries only the two STATES,
// which have no dropdown and belong to no vocabulary. They combine with AND, with each other and
// with the code search: no filter cancels another, and a bar showing two active filters shows
// their intersection.
import { type FleetFixedCrewRowDto, type FleetRosterRowDto } from '@ecms/contracts';
import { matchesVehicleCode } from './vehicle-code-match';

/** The two STATE views. A mission is not one of these — it travels as `mission=<id>`. */
export const ROSTER_VIEWS = ['workshop', 'assigned'] as const;
export type RosterView = (typeof ROSTER_VIEWS)[number];

/** `view=` from the URL, or `null` for anything this build does not know. */
export const readView = (raw: string | null): RosterView | null =>
  raw !== null && (ROSTER_VIEWS as readonly string[]).includes(raw) ? (raw as RosterView) : null;

/**
 * Does this row carry a plan? Mission, or a driver in either seat.
 *
 * The page's own «تشغيل» counter has always been this predicate; it is lifted here unchanged so
 * the counter and the filter cannot drift into counting one thing and showing another. Notes are
 * deliberately not part of it: a note is a remark about the day, not a plan for it.
 */
export const carriesPlan = (row: FleetRosterRowDto): boolean =>
  row.missionTypeId !== null || row.driver1EmployeeId !== null || row.driver2EmployeeId !== null;

/**
 * The two seats, and nothing else — what `hasDriver` actually reads.
 *
 * Structural, because BOTH boards ask the question: the daily row and the standing row carry the
 * same two seats and differ in everything around them (a date, a `planned` flag). One predicate
 * for one fact, or the «crewed» chip on one screen and the «معيّنة» badge on the other drift into
 * two definitions of «somebody is on this car».
 */
type Seated = Pick<FleetRosterRowDto, 'driver1EmployeeId' | 'driver2EmployeeId'>;

/**
 * Does this row have a CREW? A driver in either seat, and nothing else counts.
 *
 * Deliberately NOT `carriesPlan`, and the difference is the whole reason both exist. `carriesPlan`
 * is what «تشغيل» has always meant — a mission OR a driver — and it drives the counter and the
 * filter. This one answers a narrower question the assignment badge asks: is anybody actually ON
 * this car? A mission with no driver is an intention, not an assignment, and labelling such a row
 * «معيّنة» tells the dispatcher a crew exists where none does.
 *
 * Two names because they are two facts. Folding them together would make the badge and the
 * counter agree by accident and drift apart the day either question changes — the same mistake
 * the «صيانة» state and the «نقل أموال (صيانة)» mission type are kept apart to avoid.
 */
export const hasDriver = (row: Seated): boolean =>
  row.driver1EmployeeId !== null || row.driver2EmployeeId !== null;

/**
 * The rows the board should SHOW, given everything the URL is asking for.
 *
 * Every filter narrows; none replaces another. `term` is read as VEHICLE CODES, by the canonical
 * parser every other code box in the application is read with — so it takes a list (`150 - 151`
 * shows both cars) and it matches the code alone. It used to match the plate as well, which meant
 * the board could answer with a row whose only visible identifier was not what had been typed.
 *
 * This is display only. The draft, the counters, the driver pool and what «حفظ» sends all read
 * the WHOLE day and never this result — a filter is a way of looking at the board, not a way of
 * editing it, and a save that only wrote the visible rows would silently drop the rest.
 */
/**
 * Is this car's mission one of the ones asked for?
 *
 * SEVERAL, ORed — «اى فلتر ف الحركه زياده عن اتنين اختار ما بينهم اعملى multi selection». The
 * mission vocabulary is a catalog with as many entries as the company files, so «نقل أموال أو
 * توزيع» is an ordinary question about a day and one chip at a time made it two readings of the
 * board. Nothing asked for is EVERY car, including one carrying no mission at all; asked for and
 * missionless is a miss, which is what «أرني مأموريات النقل» means.
 */
export const matchesMission = (
  missionTypeId: string | null,
  missions: readonly string[] | undefined,
): boolean => {
  if (missions === undefined || missions.length === 0) return true;
  return missionTypeId !== null && missions.includes(missionTypeId);
};

export const visibleRows = (
  rows: readonly FleetRosterRowDto[],
  filters: { term?: string; missions?: readonly string[]; view?: RosterView | null },
): FleetRosterRowDto[] => {
  const term = filters.term ?? '';
  const view = filters.view ?? null;
  return rows.filter((row) => {
    if (!matchesVehicleCode(row.code, term)) return false;
    if (!matchesMission(row.missionTypeId, filters.missions)) return false;
    if (view === 'workshop' && !row.inMaintenance) return false;
    if (view === 'assigned' && !carriesPlan(row)) return false;
    return true;
  });
};

// ── the STANDING board ─────────────────────────────────────────────────────
//
// «عاوز الطاقم الثابت الفلاتر بتاعته تكون زى تعيين السيارات». The same bar, and now the same
// three questions as well: «صيانة» was the one the standing board could not be asked, although it
// draws the workshop badge on every row — said once and left out of the filters is the shape of
// bug this instruction keeps catching. It means something narrower here than on the daily board:
// there the workshop REFUSES the assignment, while a car in the workshop still has a standing
// crew, so this is a way of looking rather than a verdict. Beside it are the two states only this
// board has, «بطقم» and «بدون طقم», and the same mission vocabulary. Three views, one mission key,
// the same AND.

/**
 * The STATE views of the standing board — «خلى الفلاتر بتاعت الطقم الثابت زى تعيين السيارات».
 *
 * «صيانة» is here because the board already SHOWS it: every row carries the workshop badge, from
 * the same `inMaintenance` the daily board reads. A screen that can say a car is in the workshop
 * and cannot be asked «show me those» is the one filter the two boards did not share.
 *
 * What it does NOT mean on this board is what it means on the daily one. There, the workshop
 * refuses the assignment; here a car in the workshop still HAS a standing crew, and the filter is
 * a way of looking rather than a verdict — which is exactly why it is a view and not a state the
 * rows are sorted into.
 */
export const FIXED_ROSTER_VIEWS = ['workshop', 'crewed', 'uncrewed'] as const;
export type FixedRosterView = (typeof FIXED_ROSTER_VIEWS)[number];

/** `view=` from the URL, or `null` for anything this board does not know — the daily rule. */
export const readFixedView = (raw: string | null): FixedRosterView | null =>
  raw !== null && (FIXED_ROSTER_VIEWS as readonly string[]).includes(raw)
    ? (raw as FixedRosterView)
    : null;

/**
 * The rows the STANDING board should show. `visibleRows`, on this board's rows and this board's
 * three states — `hasDriver` is the crewed test, because a standing crew IS the two seats, and a
 * mission with nobody in either seat is not a crew.
 *
 * Display only, like its twin: the draft, the counters, the pool and what «حفظ» sends all read
 * the whole board.
 */
export const visibleFixedRows = (
  rows: readonly FleetFixedCrewRowDto[],
  filters: { term?: string; missions?: readonly string[]; view?: FixedRosterView | null },
): FleetFixedCrewRowDto[] => {
  const term = filters.term ?? '';
  const view = filters.view ?? null;
  return rows.filter((row) => {
    if (!matchesVehicleCode(row.code, term)) return false;
    if (!matchesMission(row.missionTypeId, filters.missions)) return false;
    if (view === 'workshop' && !row.inMaintenance) return false;
    if (view === 'crewed' && !hasDriver(row)) return false;
    if (view === 'uncrewed' && hasDriver(row)) return false;
    return true;
  });
};

/**
 * The colour a counter wears — its own, kept whether or not it is the one being applied.
 *
 * The three fixed chips take the tones they already had, and they are the tones that MEAN
 * something on this screen: rose for the workshop, which is the same red the in-workshop row is
 * tinted with, and emerald for a car that is working. That agreement is deliberate. Everything
 * else is a mission type, whose colour identifies it and must never read as a verdict about it.
 *
 * Mission colours are HASHED FROM THE CATALOG ID, not taken by position — the same reasoning as
 * `vehicleColour`, which this borrows its palette from: a colour derived from an index would
 * shift every other mission's colour the day somebody archives one, and a category whose colour
 * moves is worse than a category with no colour. Cycling past the end of the palette is expected
 * and fine; a fleet has a handful of mission types, not fifty.
 */
export const COUNTER_TONES = {
  total: 'bg-brand-100 text-brand-800 ring-brand-500 dark:bg-brand-900/40 dark:text-brand-100',
  workshop: 'bg-rose-100 text-rose-800 ring-rose-500 dark:bg-rose-900/40 dark:text-rose-100',
  assigned:
    'bg-emerald-100 text-emerald-800 ring-emerald-500 dark:bg-emerald-900/40 dark:text-emerald-100',
} as const;

/** Mission hues: distinct from each other and from the three above, none of them a verdict. */
export const MISSION_TONES = [
  'bg-violet-100 text-violet-800 ring-violet-500 dark:bg-violet-900/40 dark:text-violet-100',
  'bg-sky-100 text-sky-800 ring-sky-500 dark:bg-sky-900/40 dark:text-sky-100',
  'bg-amber-100 text-amber-900 ring-amber-500 dark:bg-amber-900/40 dark:text-amber-100',
  'bg-teal-100 text-teal-800 ring-teal-500 dark:bg-teal-900/40 dark:text-teal-100',
  'bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-500 dark:bg-fuchsia-900/40 dark:text-fuchsia-100',
  'bg-cyan-100 text-cyan-800 ring-cyan-500 dark:bg-cyan-900/40 dark:text-cyan-100',
  'bg-lime-100 text-lime-900 ring-lime-500 dark:bg-lime-900/40 dark:text-lime-100',
  'bg-orange-100 text-orange-900 ring-orange-500 dark:bg-orange-900/40 dark:text-orange-100',
] as const;

/**
 * FNV-1a, 32-bit — the same function `vehicle-colour.ts` documents at length, and written out
 * again rather than imported because that module's export is about VEHICLES and widening it to
 * mean "any stable colour" would make one screen's palette another screen's dependency. Six
 * lines, no state, and identical answers: the duplication costs less than the coupling.
 */
const hash = (value: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

export const missionTone = (missionTypeId: string): string =>
  MISSION_TONES[hash(missionTypeId) % MISSION_TONES.length] as string;

/**
 * The row colour for a car edited and not yet saved, shared by both roster boards.
 *
 * «يعمل الbackground للصف او العربيه اللى حصل عليها تغيير ولسه معملش حفظ، لما يعمل حفظ اللون
 * يتشال عشان ممكن يعمل تعديل ويخودش باله هو عدل ايه».
 *
 * AMBER, and not by coin toss. The two roster screens already spend rose on «this car is in the
 * workshop today» and emerald on «this car has a crew», so a third meaning needed a third hue —
 * and amber is the one both screens ALREADY use for unsaved work: the «فيه تعديلات مش محفوظة»
 * line and the reset control are amber on both. The row now says in colour what that line says
 * in words, per row instead of per screen.
 *
 * Declared once, in the library both boards import, because two screens showing the same state
 * in two different colours is the defect this is fixing, one level up.
 */
export const UNSAVED_ROW =
  'bg-amber-50 text-amber-950 hover:bg-amber-100/70 dark:bg-amber-950/40 dark:text-amber-50 dark:hover:bg-amber-950/60';
