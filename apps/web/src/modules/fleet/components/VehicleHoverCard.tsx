// «عاوز لما اماوس يقف على كود عربيه يجيب بيانات زى اما اقف على اسم السواق نفس الموضوع كدا» —
// scope «زى ما انت اقترحت», fields «تمام وزود اخر عداد».
//
// The CAR card, the driver card's sibling: on every Fleet register table and board chip that shows
// a car's code — never inside a picker, a filter or a form dialog — a short hover on the code (or
// Tab onto it) opens a card about the car: its code, make and state, then the plate, the car's OWN
// branch, its operation, today's drivers, the licence's expiry and the last odometer reading.
//
// How it behaves is the driver card's, to the class — the open/close control, the layer that
// places it and the frame are the shared ones (`HoverCardLayer`), so a car's card and a driver's
// card are never open at once.
//
// - Shown only to a reader with `fleetVehicle.view`: the card is the registry's facts.
// - Nothing is fetched until a card first opens. Then every fact comes from a list Fleet's screens
//   already share (see `lib/vehicle-card.ts`) — one cached list each, not a request per code.
// - A row whose `vehicleId` is null (the old books) gets no card; a code-only chip looks its car
//   up by code. Once the registry is in hand, a code it does not carry loses its trigger.
// - `focusable: false` where the code sits in a chip that already takes clicks or drags (the
//   roster boards, custody's «السجل», the fuel card) — no tab stop of its own; the hover works.
import { type ReactNode, type RefObject } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { useAppSelector } from '../../../store';
import { useBranchNames } from '../../organization/shared/references';
import {
  useAllVehicles,
  useCanReadAlarms,
  useFleetCatalog,
  useFleetPeople,
  useLatestReadings,
  useRosterToday,
  useVehicleTypes,
} from '../api/fleet-queries';
import {
  findCardVehicle,
  vehicleCardFacts,
  vehicleCardRefKind,
  type CardList,
  type CardVehicle,
  type NamedById,
  type VehicleCardFacts,
  type VehicleCardRef,
} from '../lib/vehicle-card';
import { BoardIcon, ymd, type ExpiryState } from './FuelCardBoard';
import { FILTER_ICON } from './FilterWithIcon';
import {
  HOVER_CARD_FACTS,
  HOVER_CARD_ICON,
  HoverCardFact as Fact,
  HoverCardLayer,
  HoverCardMissing as Missing,
  useHoverCard,
  type HoverCardTriggerProps,
} from './HoverCardLayer';
import { InWorkshopBadge, LicenceTag, VehicleStatusBadge } from './VehicleStatusBadge';

export type { VehicleCardRef } from '../lib/vehicle-card';

/** What the code's own element takes. Empty when there is no card to show. */
export interface VehicleCardTriggerProps extends HoverCardTriggerProps {
  'data-vehicle-hover'?: string;
}

/** The whole registry, every status — the one list the card's car is read from. */
const useRegistry = (enabled: boolean) => useAllVehicles({ anyStatus: true }, enabled);

/**
 * The card for one car. Spread `triggerProps` on the element that draws the code and render `card`
 * beside it; `card` is a portal, so where it sits in the markup changes nothing on screen.
 *
 * `ref` names the car: `{ vehicleId }` for a row linked to the registry (null → no card), or
 * `{ code }` for a chip that carries only the code. See `VehicleCardRef`.
 */
export const useVehicleHoverCard = (
  ref: VehicleCardRef,
  { focusable = true }: { focusable?: boolean } = {},
): { triggerProps: VehicleCardTriggerProps; card: ReactNode } => {
  const can = useCan();
  // Watched, never fetched from here: the card's first opening fetches the registry, and from
  // then on a code the registry does not carry has nothing to open.
  const registry = useRegistry(false);
  const known =
    registry.data === undefined || findCardVehicle(registry.data.items, ref) !== undefined;
  const active = can('fleetVehicle.view') && vehicleCardRefKind(ref) !== null && known;
  const hover = useHoverCard(active, { focusable });
  if (!active) return { triggerProps: {}, card: null };
  const triggerProps: VehicleCardTriggerProps = {
    // A mark, not the id: a board's markup carries no raw id for a car it can name by its code.
    'data-vehicle-hover': 'true',
    ...hover.triggerProps,
  };
  const card = hover.open ? (
    <VehicleCardLayer id={hover.id} anchor={hover.anchor} carRef={ref} />
  ) : null;
  return { triggerProps, card };
};

/** The card in its layer — once the registry names the car; nothing for a car it does not carry. */
const VehicleCardLayer = ({
  id,
  anchor,
  carRef,
}: {
  id: string;
  anchor: RefObject<HTMLElement | null>;
  carRef: VehicleCardRef;
}): JSX.Element | null => {
  const registry = useRegistry(true);
  const vehicle =
    registry.data === undefined ? undefined : findCardVehicle(registry.data.items, carRef);
  // Answered without the car (deleted since), or not answered at all: no empty frame on screen.
  if (registry.data !== undefined ? vehicle === undefined : registry.isError) return null;
  return (
    <HoverCardLayer id={id} anchor={anchor} mark="vehicle">
      {vehicle === undefined ? (
        <VehicleCardPending code={carRef.code ?? null} />
      ) : (
        <VehicleCardBody vehicle={vehicle} />
      )}
    </HoverCardLayer>
  );
};

/** The card's head: the truck, the code (the line the card is about), the make under it. */
const CardHead = ({
  code,
  type,
  badge,
}: {
  code: ReactNode;
  type: ReactNode;
  badge?: ReactNode;
}): JSX.Element => (
  <div className="flex items-start gap-2">
    <span aria-hidden className={HOVER_CARD_ICON}>
      <BoardIcon d={FILTER_ICON.car} className="h-3.5 w-3.5" />
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-[15px] font-extrabold leading-snug">{code}</p>
      <p
        data-vehicle-card-type="true"
        className="break-words text-xs font-semibold leading-snug text-slate-500 dark:text-slate-400"
      >
        {type}
      </p>
    </div>
    {badge}
  </div>
);

/** While the registry is on its way: the code as the board drew it, and «…». */
const VehicleCardPending = ({ code }: { code: string | null }): JSX.Element => (
  <div data-vehicle-card-pending="true">
    <CardHead
      code={
        code === null ? (
          <Missing loading />
        ) : (
          <span dir="ltr" className="font-figures">
            {code}
          </span>
        )
      }
      type={<Missing loading />}
    />
  </div>
);

/** A count in Latin digits, grouped — «154,320» — as the odometer screens write it. */
const LATIN = new Intl.NumberFormat('en-US');

/** The licence date in the vehicles board's colours: red when run out, amber when close. */
const LICENCE_INK: Record<ExpiryState, string> = {
  expired: 'text-red-600 dark:text-red-400',
  soon: 'text-amber-600 dark:text-amber-400',
  valid: '',
  unknown: '',
};

/** A name that is still loading, or missing, as the card says it. */
const Named = ({ value }: { value: string | 'loading' | null }): JSX.Element =>
  value === null || value === 'loading' ? <Missing loading={value === 'loading'} /> : <>{value}</>;

/** What the card says about one car, from its facts. Exported for the specs. */
export const VehicleFacts = ({ facts }: { facts: VehicleCardFacts }): JSX.Element => {
  const t = useT();
  const { drivers, licence, reading } = facts;
  return (
    <div data-vehicle-card-code={facts.code}>
      <CardHead
        code={
          <span dir="ltr" className="font-figures">
            {facts.code}
          </span>
        }
        type={<Named value={facts.type} />}
        // In the workshop says more than «نشطة» does about where the car is now.
        badge={
          <span
            className="mt-0.5 shrink-0"
            data-vehicle-card-state={facts.inWorkshop ? 'inWorkshop' : facts.status}
          >
            {facts.inWorkshop ? (
              <InWorkshopBadge inWorkshop />
            ) : (
              <VehicleStatusBadge status={facts.status} />
            )}
          </span>
        }
      />
      <dl className={HOVER_CARD_FACTS}>
        <Fact label={t('fleet.vehicles.columns.plate')}>
          {facts.plate === null ? <Missing /> : <span className="font-figures">{facts.plate}</span>}
        </Fact>
        <Fact label={t('fleet.vehicles.columns.branch')}>
          <Named value={facts.branch} />
        </Fact>
        <Fact label={t('fleet.maintenance.fields.operation')}>
          <Named value={facts.operation} />
        </Fact>
        {/* No `fleetRoster.view`: no drivers line at all, rather than a dash that reads «none». */}
        {drivers.kind !== 'hidden' && (
          <Fact label={t('fleet.vehicles.card.driversToday')}>
            {drivers.kind === 'loading' || drivers.names.length === 0 ? (
              <Missing loading={drivers.kind === 'loading'} />
            ) : (
              <span data-vehicle-card-drivers={drivers.names.length}>
                {drivers.names.map((name, index) => (
                  <span key={`${index}-${name}`} className="block">
                    {name}
                  </span>
                ))}
              </span>
            )}
          </Fact>
        )}
        <Fact label={t('fleet.vehicles.columns.license')}>
          {licence.date === null ? (
            <Missing />
          ) : (
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span dir="ltr" className={cn('font-figures', LICENCE_INK[licence.state])}>
                {ymd(licence.date)}
              </span>
              <LicenceTag state={licence.state} />
            </span>
          )}
        </Fact>
        {/* No odometer or workshop permission: no reading line at all, rather than a dash that reads «none». */}
        {reading.kind !== 'hidden' && (
          <Fact label={t('fleet.vehicle.lastReading')}>
            {reading.kind !== 'reading' ? (
              <Missing loading={reading.kind === 'loading'} />
            ) : (
              // One line: the figures' face is monospaced, so a six-figure reading and a date
              // always take the same room; thin spaces round the dot keep it inside the width.
              <span data-vehicle-card-reading="true" className="whitespace-nowrap">
                <span>
                  <span dir="ltr" className="font-figures">
                    {LATIN.format(reading.km)}
                  </span>{' '}
                  {t('fleet.vehicle.km')}
                </span>
                <span className="text-slate-400 dark:text-slate-500">{' · '}</span>
                {/* The reading's day, a size down and muted: the km is the fact, the day says
                    how fresh it is. */}
                <span
                  dir="ltr"
                  className="whitespace-nowrap font-figures text-xs font-semibold text-slate-500 dark:text-slate-400"
                >
                  {ymd(reading.at)}
                </span>
              </span>
            )}
          </Fact>
        )}
      </dl>
    </div>
  );
};

/** One of the shared lists, as the facts take it: the rows, `loading`, or null when it failed. */
const listOf = <T extends NamedById>(query: {
  data?: { items: T[] } | undefined;
  isError: boolean;
}): CardList<NamedById> => query.data?.items ?? (query.isError ? null : 'loading');

/**
 * The card's content for one car: the facts, each from its shared list. Exported for the specs,
 * which seed the lists and read what it says.
 */
export const VehicleCardBody = ({ vehicle }: { vehicle: CardVehicle }): JSX.Element => {
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The drivers line needs both the day's board and the people who name the drivers on it.
  const mayReadRoster = can('fleetRoster.view');
  const mayReadPeople = can('fleetDriver.view');
  const mayReadReadings = useCanReadAlarms();
  const drivers = mayReadRoster && mayReadPeople;
  const types = useVehicleTypes();
  const operations = useFleetCatalog('operation');
  const branches = useBranchNames();
  const roster = useRosterToday(drivers);
  const people = useFleetPeople(drivers);
  // Every car's last reading, any status — not the alarms, which cover active cars only.
  const latest = useLatestReadings();
  return (
    <VehicleFacts
      facts={vehicleCardFacts({
        vehicle,
        types: listOf(types),
        operations: listOf(operations),
        branches: branches.data ?? (branches.isError ? null : 'loading'),
        roster: !drivers || roster.isError ? 'hidden' : (roster.data ?? 'loading'),
        people: !drivers || people.isError ? 'hidden' : (people.data ?? 'loading'),
        readings: !mayReadReadings || latest.isError ? 'hidden' : (latest.data ?? 'loading'),
        locale,
      })}
    />
  );
};

/**
 * A car code drawn as text on a board — the code cell. With a car Fleet knows, the text opens its
 * card; without, it is the text as before. The trigger is the code's own element, never a wrapper.
 * `children` default to the code.
 */
export const VehicleHoverCode = ({
  vehicleId,
  code,
  focusable = true,
  className,
  dir,
  children,
}: VehicleCardRef & {
  focusable?: boolean;
  className?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  children?: ReactNode;
}): JSX.Element => {
  const { triggerProps, card } = useVehicleHoverCard(
    vehicleId === undefined ? { code: code ?? null } : { vehicleId, code: code ?? null },
    { focusable },
  );
  return (
    <>
      <span dir={dir} className={className} {...triggerProps}>
        {children ?? code}
      </span>
      {card}
    </>
  );
};
