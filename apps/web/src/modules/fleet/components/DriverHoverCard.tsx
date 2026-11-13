// «عاوز فى اى شااشه اقف على اسم السواق يجيب الاسم كامل والكود ورقم الفون والعربيه اللى متعين
// عليها والفرع».
//
// ONE card, hung on the shared name renderers — `DriverCell`, `EmployeeName` / `DriverName`,
// `DriverChip`, `DriverIdentity` — so every screen that draws a driver through them shows it, and
// a screen added later gets it by drawing its names the usual way.
//
// How it behaves, and why:
// - It opens on a short hover, or at once when the name is reached with the keyboard (Tab); it
//   closes when the pointer leaves, on blur, on Escape, on any press, and when a drag starts.
// - It is ATTACHED to the name's own element (`triggerProps`), never a wrapper around it, so a
//   board's layout — the roster chip's full width, the centred maintenance stack — is untouched.
// - It is drawn in a layer of its own over everything (a portal), and it takes no pointer events:
//   a click, a drag or a scroll goes to whatever is under it, exactly as without the card. It
//   follows its name as a table scrolls inside itself, and hides when the name leaves the screen —
//   or the box it scrolls in, or slides under that box's sticky head, long before the window's edge.
// - One open at a time — across the driver card and the car card (`VehicleHoverCard`) alike.
//
// Those mechanics — the open/close control, the layer that places the card, the frame — are the
// shared ones in `HoverCardLayer.tsx`; this file says what a DRIVER's card says.
// - Nothing is fetched until a card first opens: the people are the list the name already came
//   from; the branch names and today's roster are each ONE cached list shared by every card — not
//   a request per name.
// - A name Fleet does not know (a name from the old books, an id not on the roster) gets no card;
//   it keeps the title it has always had.
import { type ReactNode } from 'react';
import { type FleetPersonDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { useAppSelector } from '../../../store';
import { useBranchOptions } from '../../organization/shared/references';
import { useRosterToday } from '../api/fleet-queries';
import { driverCardFacts, type DriverCardFacts } from '../lib/driver-card';
import {
  HOVER_CARD_FACTS,
  HOVER_CARD_ICON,
  HoverCardFact,
  HoverCardLayer,
  HoverCardMissing,
  useHoverCard,
  type HoverCardTriggerProps,
} from './HoverCardLayer';

// The placing helpers live with the shared layer now; named here too, where the odometer's reason
// card (`AlarmReasonCell`) and the specs have always found them.
export { clippingBoxes, nameInSight, type ScreenBox } from './HoverCardLayer';

/** What the name's own element takes. Empty for a name Fleet does not know. */
export interface DriverCardTriggerProps extends HoverCardTriggerProps {
  'data-driver-hover'?: string;
}

/**
 * The card for one name (or several — an accident's culprits). Spread `triggerProps` on the
 * element that draws the name and render `card` beside it; `card` is a portal, so where it sits
 * in the markup changes nothing on screen.
 *
 * `people` are the records the name was drawn from — passed in, not looked up again, so a board of
 * two hundred chips builds no second roster map per chip. Pass `[]` for a name Fleet does not know.
 *
 * `focusable: false` where the name sits inside something that already owns the keyboard — a
 * picker's box, a draggable chip — so it adds no tab stop of its own there; the hover still works.
 *
 * The open/close control and the layer are the shared ones (`HoverCardLayer`), so a driver's card
 * and a car's card are never open at once.
 */
export const useDriverHoverCard = (
  people: readonly FleetPersonDto[],
  { focusable = true }: { focusable?: boolean } = {},
): { triggerProps: DriverCardTriggerProps; card: ReactNode } => {
  const key = people.map((person) => person.employeeId).join(',');
  const hover = useHoverCard(key !== '', { focusable });
  if (key === '') return { triggerProps: {}, card: null };
  const triggerProps: DriverCardTriggerProps = {
    // A mark, not the id: a board's markup never carries a raw id for a person it can name.
    'data-driver-hover': 'true',
    ...hover.triggerProps,
  };
  const card = hover.open ? (
    <HoverCardLayer id={hover.id} anchor={hover.anchor} mark="driver">
      <DriverCardBody people={people} />
    </HoverCardLayer>
  ) : null;
  return { triggerProps, card };
};

/** A fact the books do not have, or one still on its way — never a guess. (The shared one.) */
const Missing = HoverCardMissing;
const Fact = HoverCardFact;

const PersonFacts = ({ facts }: { facts: DriverCardFacts }): JSX.Element => {
  const t = useT();
  const { vehicle } = facts;
  return (
    <div data-driver-card-person={facts.employeeId}>
      <p className="flex items-start gap-2 text-[15px] font-extrabold leading-snug">
        <span aria-hidden className={HOVER_CARD_ICON}>
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
          </svg>
        </span>
        {/* The WHOLE name, wrapped — the reason the card exists on a board that cuts it. */}
        <span className="min-w-0 whitespace-normal break-words">{facts.name}</span>
      </p>
      <dl className={HOVER_CARD_FACTS}>
        <Fact label={t('fleet.drivers.columns.employeeCode')}>
          {facts.code === '' ? (
            <Missing />
          ) : (
            <span dir="ltr" className="font-figures">
              {facts.code}
            </span>
          )}
        </Fact>
        <Fact label={t('fleet.drivers.columns.phone')}>
          {facts.phone === null ? (
            <Missing />
          ) : (
            <span dir="ltr" className="font-figures">
              {facts.phone}
            </span>
          )}
        </Fact>
        {/* No `fleetRoster.view`: no car line at all, rather than a dash that reads «no car». */}
        {vehicle.kind !== 'hidden' && (
          <Fact label={t('fleet.drivers.card.vehicle')}>
            {vehicle.kind === 'car' ? (
              <span dir="ltr" className="font-figures">
                {vehicle.code}
              </span>
            ) : vehicle.kind === 'elsewhere' ? (
              t('fleet.roster.otherVehicle')
            ) : (
              <Missing loading={vehicle.kind === 'loading'} />
            )}
          </Fact>
        )}
        <Fact label={t('fleet.drivers.columns.branch')}>
          {facts.branch === null || facts.branch === 'loading' ? (
            <Missing loading={facts.branch === 'loading'} />
          ) : (
            facts.branch
          )}
        </Fact>
      </dl>
    </div>
  );
};

/**
 * The card's content: one block per driver — the name, then the code, phone, today's car and the
 * branch. Exported for the specs, which seed the three lists and read what it says.
 */
export const DriverCardBody = ({ people }: { people: readonly FleetPersonDto[] }): JSX.Element => {
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const mayReadRoster = can('fleetRoster.view');
  const roster = useRosterToday(mayReadRoster);
  const branches = useBranchOptions();
  return (
    <div className="space-y-3">
      {people.map((person, index) => (
        <div
          key={person.employeeId}
          className={cn(index > 0 && 'border-t border-slate-200 pt-3 dark:border-[#2b3b6b]')}
        >
          <PersonFacts
            facts={driverCardFacts({
              person,
              branches: branches.data ?? (branches.isError ? null : 'loading'),
              roster: !mayReadRoster || roster.isError ? 'hidden' : (roster.data ?? 'loading'),
              locale,
            })}
          />
        </div>
      ))}
    </div>
  );
};

/**
 * A name drawn as plain text that is not one of the shared renderers' — an accident's culprit,
 * which may be several of ours or a third party's. With the people behind it, the text opens
 * their card; without, it is the text as before.
 */
export const DriverHoverText = ({
  people,
  children,
  className,
}: {
  people: readonly FleetPersonDto[];
  children: ReactNode;
  className?: string;
}): JSX.Element => {
  const { triggerProps, card } = useDriverHoverCard(people);
  return (
    <>
      <span className={className} {...triggerProps}>
        {children}
      </span>
      {card}
    </>
  );
};
