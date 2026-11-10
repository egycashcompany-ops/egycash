// The day board's two hover cards — «لما اقف على العربيه تجيب مين اللى متعين عليها من سواقيين
// واخصائيين و لما اقف على القائد يجيب بياناته زى ما عاملين فى الحركه».
//
// - The VAN card, on the vehicle code: who rides that van on the crew row the shipment's leg is on
//   — its drivers (the Fleet duty row's, by name only: their details are Fleet's), its captain and
//   both specialists, then the direction and the planned time when the row has them.
// - The CAPTAIN card, on the captain's name: the Fleet driver card's facts, for the captain — the
//   whole name, the employee code, the mobile number, the van and the branch.
//
// The mechanics are Fleet's own (`HoverCardLayer`): the same open/close control, layer and frame,
// so a board card and a Fleet card are never open at once and behave alike to the class.
//
// Every fact comes with the board itself (`GET /operations/shipments/day-board`): nothing is fetched
// when a card opens, except the branch names (one cached list any signed-in reader may read).
// Fleet's cards could not serve here — Fleet's people list has no captains or specialists, and its
// car card names only the drivers.
//
// A reader without `operationsCrew.view` gets no crew list from the server and no phone: the van
// code stays plain text, and the captain card has no phone line, rather than a dash that reads
// «no phone».
import { type ReactNode } from 'react';
import {
  type Locale,
  type OperationsDayBoardCrewDto,
  type OperationsDayBoardDriverDto,
  type OperationsDayBoardPersonDto,
  type OperationsDayBoardVehicleCrewDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { useBranchNames } from '../../organization/shared/references';
import { FILTER_ICON } from '../../fleet/components/FilterWithIcon';
import { BoardIcon } from '../../fleet/components/FuelCardBoard';
import {
  HOVER_CARD_FACTS,
  HOVER_CARD_ICON,
  HoverCardFact as Fact,
  HoverCardLayer,
  HoverCardMissing as Missing,
  useHoverCard,
} from '../../fleet/components/HoverCardLayer';

/** A code, a phone or a time: a figure, read left to right in the figures' face. */
const Figure = ({ children }: { children: ReactNode }): JSX.Element => (
  <span dir="ltr" className="font-figures">
    {children}
  </span>
);

/** The person drawing at the head of the captain card — the Fleet driver card's. */
const PersonIcon = (): JSX.Element => (
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
);

/** The card's head line: its drawing, then the line the card is about. */
const CardHead = ({
  icon,
  children,
  sub,
}: {
  icon: ReactNode;
  children: ReactNode;
  sub?: ReactNode;
}): JSX.Element => (
  <div className="flex items-start gap-2">
    <span aria-hidden className={HOVER_CARD_ICON}>
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <p className="whitespace-normal break-words text-[15px] font-extrabold leading-snug">
        {children}
      </p>
      {sub}
    </div>
  </div>
);

/** The branch's name, from the one shared list — «…» while it loads, «—» for none. */
const useBranchName = (branchId: string | null): string | 'loading' | null => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useBranchNames(branchId !== null);
  if (branchId === null) return null;
  if (branches.data === undefined) return branches.isError ? null : 'loading';
  const branch = branches.data.find((option) => option.id === branchId);
  if (branch === undefined) return null;
  return branch.name[locale] || branch.name.ar || branch.name.en;
};

/**
 * What the captain card says, from the row's own crew. Exported for the specs. `mayReadCrew`: the
 * reader holds `operationsCrew.view` — without it the server sends no phone, and the card has no
 * phone line at all.
 */
export const CaptainCardBody = ({
  crew,
  mayReadCrew,
}: {
  crew: OperationsDayBoardCrewDto;
  mayReadCrew: boolean;
}): JSX.Element => {
  const t = useT();
  const branch = useBranchName(crew.captainBranchId);
  return (
    <div data-captain-card="true">
      <CardHead icon={<PersonIcon />}>
        {/* The WHOLE name, wrapped — the board's column may cut it. */}
        {crew.captainName ?? <Missing />}
      </CardHead>
      <dl className={HOVER_CARD_FACTS}>
        <Fact label={t('fleet.drivers.columns.employeeCode')}>
          {crew.captainCode === null ? <Missing /> : <Figure>{crew.captainCode}</Figure>}
        </Fact>
        {mayReadCrew && (
          <Fact label={t('fleet.drivers.columns.phone')}>
            {crew.captainPhone === null ? <Missing /> : <Figure>{crew.captainPhone}</Figure>}
          </Fact>
        )}
        {/* The van of THIS shipment's leg — the board may be any day, so not «today's car». */}
        <Fact label={t('operations.board.vehicle')}>
          {crew.vehicleCode === null ? <Missing /> : <Figure>{crew.vehicleCode}</Figure>}
        </Fact>
        <Fact label={t('fleet.drivers.columns.branch')}>
          {branch === null || branch === 'loading' ? (
            <Missing loading={branch === 'loading'} />
          ) : (
            branch
          )}
        </Fact>
      </dl>
    </div>
  );
};

/**
 * The captain's name on a board row, with his card. The trigger is the name's own element; the
 * card is a portal, so the cell's layout is what it was.
 */
export const CaptainHoverName = ({
  crew,
  className,
}: {
  crew: OperationsDayBoardCrewDto;
  className?: string;
}): JSX.Element => {
  const can = useCan();
  const hover = useHoverCard(crew.captainName !== null);
  return (
    <>
      <span
        className={className}
        {...(crew.captainName === null ? {} : { 'data-captain-hover': 'true' })}
        {...hover.triggerProps}
      >
        {crew.captainName}
      </span>
      {hover.open && (
        <HoverCardLayer id={hover.id} anchor={hover.anchor} mark="captain">
          <CaptainCardBody crew={crew} mayReadCrew={can('operationsCrew.view')} />
        </HoverCardLayer>
      )}
    </>
  );
};

/**
 * The van's drivers: each on a line of its own, BY NAME ONLY — «هعرف مين السواقين اللي عليها، لكن
 * مش عايز اعرف بياناتهم». A driver's details are Fleet's (its driver card), so Operations says who
 * drives and stops there; the server sends nothing more. A driver the directory cannot name is a
 * dash.
 */
const DriverNames = ({
  drivers,
}: {
  drivers: readonly OperationsDayBoardDriverDto[];
}): JSX.Element =>
  drivers.length === 0 ? (
    <Missing />
  ) : (
    <span data-crew-card-slot="drivers" data-crew-card-count={drivers.length}>
      {drivers.map((driver) => (
        <span key={driver.employeeId} className="block">
          {driver.fullNameAr ?? <Missing />}
        </span>
      ))}
    </span>
  );

/**
 * Operations' own people in one place on the van — the captain, a specialist: each on a line of its
 * own, the name then the code.
 */
const People = ({
  people,
  slot,
}: {
  people: readonly OperationsDayBoardPersonDto[];
  slot: string;
}): JSX.Element =>
  people.length === 0 ? (
    <Missing />
  ) : (
    <span data-crew-card-slot={slot} data-crew-card-count={people.length}>
      {people.map((person) => (
        <span key={person.employeeId} className="block">
          {/* A person the directory cannot name is a dash — never a raw id. */}
          {person.fullNameAr ??
            (person.code === null ? <Missing /> : <Figure>{person.code}</Figure>)}
          {person.fullNameAr !== null && person.code !== null && (
            <span className="ms-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <Figure>{person.code}</Figure>
            </span>
          )}
        </span>
      ))}
    </span>
  );

/** What the van card says, from the board's crew row. Exported for the specs. */
export const VehicleCrewCardBody = ({
  crew,
}: {
  crew: OperationsDayBoardVehicleCrewDto;
}): JSX.Element => {
  const t = useT();
  return (
    <div data-crew-card={crew.crewAssignmentId}>
      <CardHead
        icon={<BoardIcon d={FILTER_ICON.car} className="h-3.5 w-3.5" />}
        sub={
          <p className="text-xs font-semibold leading-snug text-slate-500 dark:text-slate-400">
            {t('operations.board.card.crewTitle')}
          </p>
        }
      >
        {crew.vehicleCode === null ? <Missing /> : <Figure>{crew.vehicleCode}</Figure>}
      </CardHead>
      <dl className={HOVER_CARD_FACTS}>
        <Fact label={t('operations.board.card.drivers')}>
          <DriverNames drivers={crew.drivers} />
        </Fact>
        <Fact label={t('operations.crew.slot.captain')}>
          <People people={crew.captains} slot="captain" />
        </Fact>
        <Fact label={t('operations.crew.slot.specialist1')}>
          <People people={crew.specialist1} slot="specialist1" />
        </Fact>
        <Fact label={t('operations.crew.slot.specialist2')}>
          <People people={crew.specialist2} slot="specialist2" />
        </Fact>
        {/* Said only when the crew row has them: the card is about who rides the van. */}
        {crew.direction !== null && (
          <Fact label={t('operations.crew.direction')}>{crew.direction}</Fact>
        )}
        {crew.plannedTime !== null && (
          <Fact label={t('operations.crew.plannedTime')}>
            <Figure>{crew.plannedTime}</Figure>
          </Fact>
        )}
      </dl>
    </div>
  );
};

/**
 * The van's code on a board row. With its crew row in hand (`vehicleCrew` — none for a reader
 * without `operationsCrew.view`, or a crew row gone since), the code opens the van card; without,
 * it is the code as before.
 */
export const CrewVehicleHoverCode = ({
  code,
  vehicleCrew,
  className,
}: {
  code: ReactNode;
  vehicleCrew: OperationsDayBoardVehicleCrewDto | undefined;
  className?: string;
}): JSX.Element => {
  const hover = useHoverCard(vehicleCrew !== undefined);
  return (
    <>
      <span
        className={className}
        {...(vehicleCrew === undefined ? {} : { 'data-crew-hover': 'true' })}
        {...hover.triggerProps}
      >
        {code}
      </span>
      {hover.open && vehicleCrew !== undefined && (
        <HoverCardLayer id={hover.id} anchor={hover.anchor} mark="crew">
          <VehicleCrewCardBody crew={vehicleCrew} />
        </HoverCardLayer>
      )}
    </>
  );
};
