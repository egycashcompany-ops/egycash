// «الطقم الثابت» on a phone and a tablet — the touch board's own small pieces («واعمل ديزاين شاشة
// الطاقم الثابت زى التعيين اليومى»). Everything else on the board is the daily «تعيين السيارات»
// touch board's own piece, reused as it is (the card, the sheets, the chips, the lists); what is
// here is what a standing crew says differently, and nothing of the day:
//
//   FixedRowBadges   the card's badges: «في الورشة» when the workshop holds the car, then «معيّنة»
//                    or «بلا طقم» — the desk's «الحالة» words, in the daily card's face. No flag
//                    for a standing member who can no longer drive (owner's answer 1 ب).
//   fixedCardMenu    the ⋮ words: «تعديل» (the note — the mission is the pill, the drivers are the
//                    seats) and «إفراغ الطقم», offered only while a seat holds somebody.
//   fixedTouchFacts  what every seat is told: nobody flagged, nobody out; only the move promised
//                    («سيُنقل من السيارة 214 عند الحفظ») and the person named.
//   editTitle        «تعديل · {code}» — the mission and note sheets' title, the pen dialog's idiom.
//   missionNotice    the catalog's line over the mission sheet, when it failed or is empty.
//   PendingBanner, TargetBanner, SlotHint — the daily board's three banners, as they are drawn
//                    there: the driver chosen first, the seat being filled, the hint.
import { type FleetFixedCrewRowDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { CloseIcon } from '../../../../shared/ui/icons';
import { InWorkshopBadge } from '../VehicleStatusBadge';
import { hasDriver } from '../../lib/roster-view';
import { type FixedRosterBoardModel } from '../../lib/fixed-roster-model';
import { type CardMenu, type SeatFacts } from './RosterCarCard';

/** A standing crew's note, at most this many letters — the pen dialog's cap, on the notes sheet too. */
export const NOTE_MAX = 500;

/** `[data-car="…"]` for a code — codes are free text («MG 1/2»), so the value is escaped. */
export const carSelector = (code: string): string => `[data-car="${CSS.escape(code)}"]`;

/** The card's badges, in the daily `RowBadges` face: the workshop, then crewed or not. */
export const FixedRowBadges = ({
  row,
}: {
  row: Pick<FleetFixedCrewRowDto, 'inMaintenance' | 'driver1EmployeeId' | 'driver2EmployeeId'>;
}): JSX.Element => {
  const t = useT();
  return (
    <div data-fixed-badges="true" className="flex flex-wrap items-center gap-1.5">
      {/* Said on the card itself: on touch a workshop car stays in its place, not in a group. */}
      <InWorkshopBadge inWorkshop={row.inMaintenance} />
      {/* `hasDriver`: a mission with nobody on it is not a crew. */}
      {hasDriver(row) ? (
        <Badge tone="success">{t('fleet.roster.assigned')}</Badge>
      ) : (
        <Badge tone="neutral">{t('fleet.fixedRoster.unassigned')}</Badge>
      )}
    </div>
  );
};

/** ⋮ «تعديل» (the note) and «إفراغ الطقم» — the latter only while a seat holds somebody. */
export const fixedCardMenu = (t: (key: string) => string): CardMenu => ({
  edit: t('common.edit'),
  clear: t('fleet.fixedRoster.clearCrew'),
  canClear: hasDriver,
});

/** Nobody is flagged here (answer 1 ب) — the same empty answers for every seat. */
const NO_FLAGS: ReadonlySet<string> = new Set<string>();
const NO_REASONS: ReadonlyMap<string, string> = new Map<string, string>();

/** What a card's seats are told about their people. `armed`: a driver was chosen first. */
export const fixedTouchFacts = (
  m: Pick<FixedRosterBoardModel, 'transferFrom' | 'person'>,
  armed: boolean,
): SeatFacts => ({
  expired: NO_FLAGS,
  unavailable: NO_REASONS,
  transferFrom: m.transferFrom,
  armed,
  person: m.person,
  // Never reached: no seat here carries a reason.
  reasonLabel: (reason) => reason,
});

/** «تعديل · {code}». */
export const editTitle = (t: (key: string) => string, code: string): string =>
  `${t('common.edit')} · ${code}`;

/** The mission catalog's line, when there is something to say about it — else nothing. */
export const missionNotice = (
  t: (key: string) => string,
  catalog: FixedRosterBoardModel['missionCatalog'],
): string | undefined =>
  catalog.failed
    ? t('fleet.fixedRoster.missionTypesFailed')
    : catalog.empty
      ? t('fleet.fixedRoster.noMissionTypesYet')
      : undefined;

const BANNER_CLOSE =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/90 hover:bg-white/15';

/** «يُعيَّن الآن: {name} — اختر له خانة في إحدى السيارات.» — the driver chosen first, with ✕. */
export const PendingBanner = ({
  code,
  name,
  onCancel,
}: {
  code: string | undefined;
  name: string;
  onCancel: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      data-pending-driver={code}
      className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-700 py-1 pe-1 ps-3.5 text-white shadow-sm dark:bg-emerald-600"
    >
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-white" />
      <span className="min-w-0 flex-1 text-sm font-semibold leading-5">
        {t('fleet.roster.driverNow', { name })}
      </span>
      <button
        type="button"
        onClick={onCancel}
        aria-label={t('common.cancel')}
        className={BANNER_CLOSE}
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  );
};

/** «يُعيَّن الآن: السيارة {code} · {slot}» (· who sits there) — the seat being filled, with ✕. */
export const TargetBanner = ({
  code,
  slot,
  occupant,
  onCancel,
}: {
  code: string;
  slot: string;
  occupant: string | null;
  onCancel: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      data-target-banner="true"
      className="flex min-h-12 items-center gap-2 rounded-xl bg-brand-600 py-1 pe-1 ps-3.5 text-white shadow-sm dark:bg-brand-600"
    >
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-white" />
      <span className="min-w-0 flex-1 text-sm font-semibold leading-5">
        {t('fleet.roster.targetNow', { code, slot })}
        {occupant !== null && <> · {occupant}</>}
      </span>
      <button
        type="button"
        onClick={onCancel}
        aria-label={t('common.cancel')}
        className={BANNER_CLOSE}
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  );
};

/** «اختر خانة في إحدى السيارات ثم السائق، أو اختر السائق أولًا ثم الخانة.» */
export const SlotHint = (): JSX.Element => {
  const t = useT();
  return (
    <div
      data-target-hint="true"
      className="flex min-h-12 items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2 text-[13px] leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300"
    >
      {t('fleet.roster.pickSlotHint')}
    </div>
  );
};
