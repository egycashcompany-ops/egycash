// Cash-transfer crew planning — the legacy /tashghela workflow, ported by parity.
//
// WHAT IS PARITY AND WHAT IS PROMOTED (each promotion a named register decision, never silent):
//   · The board answers for TOMORROW when no date is given — verbatim legacy behaviour
//     (contad_app.js:2239-2247 redirects to tomorrow).
//   · Crew slots are all optional; there is no minimum crew (`row.spe1 || ""`, :2419). Each slot
//     now holds up to CREW_SLOT_CAPACITY people — a NEW capability, not a restored one: legacy
//     stored three single strings (models/tash4ela.js:10-12) and drew one card per cell
//     (tashghela.ejs:914-916). Nothing legacy did was dropped; the ceiling was raised.
//   · A crew member holds ONE row per operating day (Q11): the legacy check lived only in the
//     browser (tashghela.ejs:1332) while POST blind-upserted (:2413) — promoted to the domain,
//     end-state-checked exactly like the fleet roster's FR-7 driver half.
//   · Crew is planned only for a vehicle on the Fleet roster for that date — the normalized form
//     of the legacy car_lock gate (tashghela listed only car_lock'd vehicles, :2255), and the
//     frozen §9.4 anchor: the crew row references the Fleet duty row by id.
//     ROUND 24 — the owner reversed it: «مكان بدون سيارة دا لما ادوس عليه يجيب كل السيارات اللى
//     مش عليها طاقم واقدر اختار منهم» (production's roster is often empty for the day). Any ACTIVE
//     car with no crew that day may be given to a row; off the roster it must not be in the
//     workshop that day, and the row anchors on no duty row. Fleet stays the only writer of Fleet.
//   · Replacement is upsert-in-place per (day, vehicle), exactly the legacy findOneAndUpdate
//     upsert; unchanged rows are pure no-ops (no write, no audit, no event).
//   · APPROVED DECISION 1 (design header): absence/attendance is NOT an eligibility gate here —
//     no availability seam is consulted, unlike the fleet roster's FR-6. Deliberate.
//     ROUND 22 — the owner reversed it for a NEW placement: «لو القائد غايب ... مقدرش احطه على
//     العربيه و كذلك الاخصائيين». Somebody HR has absent or on leave on the day may not be newly
//     put on a row (`OPERATIONS_CREW_MEMBER_ABSENT`); somebody already on it stays (see `plan`).
//   · APPROVED DECISION 2: requirements flags (leader/selah/…) gate NOTHING server-side — they
//     were pool decoration and browser filters in legacy (discovery §9). Employees are validated to
//     EXIST (and not be exited) through the platform directory seam — reference integrity for the
//     normalized ids, the fleet driver-profile precedent.
//     ROUND 23 — the owner reversed it for the two ROLE flags: «ممنوع ان اعين قائد مكان اخصائى
//     والعكس الا فى حالة انه قائد اخصائى». Somebody NEWLY put in a slot must fit it — «قائد الطاقم» a
//     captain or a captain-specialist, «أخصائي 1/2» a specialist or a captain-specialist
//     (`OPERATIONS_CREW_MEMBER_WRONG_SLOT`, `crew-roles.ts`); somebody already in that slot stays.
//     Weapon, signature, licence and the rest still gate nothing.
//   · The day row is ensured on plan (get-or-create): legacy has no day entity, so demanding an
//     explicit create-day step before planning would invent ceremony. No day-status gate on
//     planning — legacy planning is lockless; execution slices gate on OPEN, not this one.
//
// ROUND 20 — «لوحة التشغيلة» as the owner approved it. Five things the legacy board had, or he asked
// for, that the crew row never stored:
//   · «النوع» — `shiftTypeId`, a type of the `أنواع التشغيل` catalog («انا عاوز النوع يكون بيضاف من
//     البيانات المرجعيه»). A type NEWLY chosen must be active; a row keeps the one it holds.
//   · The row's colour — «وعاوز زرا يبقى فى كذا لون اقدر الون به الصف» (`rowColour`).
//   · ROWS WITHOUT A VAN — «وعاوز اقدر اضيف صف ميكونش ليه عربيه واضيف كل البيانات برضو». No Fleet
//     duty row and no van; created, edited by id, and deleted in the same save as the vans' rows,
//     and counted by Q11 like any other row. Given a van later, it MOVES onto the van's row: the
//     board sends the van's row with its crew and the old row's id to remove, one save (`plan`).
//   · «الاتجاه» from the list — «اقدر اكتب بس فى الاخر لازم اختار من الاتجاهات اللى موجوده بتاعت
//     البنوك»: a new or changed direction had to name active operations areas, stored in their
//     own spelling. ROUND 28 reverses the refusal — «عاوز الاتجاه اقدر اكتبه بايدى لو مش موجود فى
//     الليست»: an area's name is still respelled as the area spells it, anything else is stored as
//     typed (`crew-direction.ts`). One saved before stays exactly while it is sent unchanged.
//   · The van's drivers by name on the board, and the day's vans in the workshop («صيانة»).
//
// ROUND 24 — «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات»: a row without a van takes
// محصنات on «توزيع المحصنات» like a van. So a row is now GIVEN a van in place («X takes V» —
// same id, its legs take the van in the same transaction), a row that holds legs is never removed
// (`OPERATIONS_CREW_ROW_HAS_SHIPMENTS`), and the board offers every car with no crew that day
// (`freeVehicles`) and lists the vans given off the roster.
//
// ROUND 32 — «لما بجيب السجل فى لوحة التشغيل بيخلى اعدل وانا عاوزها اظهار فقط»: a day before today on
// the Cairo calendar is read as that day's RECORD (`past`), and its save is refused before anything
// else (422 `OPERATIONS_CREW_DAY_IN_PAST`) — the record is read only on the server, whatever a
// client sends. And «دى مشكلة بيظهر عربيات ايه الاصفار دى»: a car whose Fleet code names nothing
// («0», «00» …) is offered last, by its plate (`uncoded-vehicles.ts`).
import {
  ErrorCodes,
  OperationsEvents,
  OperationsSettingKeys,
  cairoCalendarDate,
  cairoYmd,
  canonicalCrewRowColour,
  ymdOf,
  type OperationsCrewBoardCrewDto,
  type OperationsCrewBoardDto,
  type OperationsCrewBoardRowDto,
  OPERATIONS_CREW_FREE_VEHICLE_GROUPS,
  type OperationsCrewBoardFreeVehicleDto,
  type OperationsCrewFreeVehicleGroup,
  type OperationsCrewRowColour,
  type PlanOperationsCrew,
  type PlanOperationsCrewRow,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { getDirectoryEmployee, getDirectoryEmployees } from '../../../platform/directory';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { settingsService } from '../../../platform/settings';
import { diffChanges } from '../../../shared/utils/diff';
// §9.4 (frozen fleet design): OPS reads `fleet_duty_assignments` by date and attaches its work to
// the row by id. This import IS the boundary, not a breach of it — Fleet stays the only writer.
import {
  fleetActiveVehicles,
  fleetActiveVehiclesByIds,
  fleetDutyAssignmentRepository,
  fleetVehicleRepository,
  fleetVehicleTypeNames,
  fleetVehiclesInWorkshop,
} from '../fleet-boundary';
import { operationsDayService, utcDay } from '../days/day.service';
import { operationsShiftTypeRepository } from '../shift-types/shift-type.repository';
import { operationsStandingCrewRepository } from '../standing-crew/standing-crew.repository';
import { operationsCrewAssignmentRepository } from './crew-assignment.repository';
import { hasVan, vehicleIdOf, type OperationsCrewAssignmentDoc } from './crew-assignment.model';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { moveRowLegsToVan, recordLegVanChanges, type LegVanChange } from '../assignments/leg-van';
import { crewMembers, slotIds } from './crew-slots';
import { crewAvailabilityOn } from './crew-requirements.service';
import { CREW_SLOT_FIELD, crewRolesOf, refuseWrongSlots } from './crew-roles';
import { directionResolver } from './crew-direction';
import {
  byCarForPicker,
  byVehicleCodeNaturally,
  isUnidentified,
  uncodedOf,
} from './uncoded-vehicles';

const ORG_SUBJECT = { userId: null, branchId: null };

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'crewAssignment',
  entityId: id,
});

/**
 * The audited/compared surface — the crew facts, nothing derived. Its KEY ORDER is the order
 * `plan` builds a row's next state in: the two are compared as JSON to tell a change from a no-op.
 */
const snapshot = (doc: OperationsCrewAssignmentDoc) => ({
  captainEmployeeIds: slotIds(doc.captainEmployeeIds),
  specialist1EmployeeIds: slotIds(doc.specialist1EmployeeIds),
  specialist2EmployeeIds: slotIds(doc.specialist2EmployeeIds),
  direction: doc.direction,
  plannedTime: doc.plannedTime,
  notes: doc.notes,
  // `== null`: a row written before Round 20 has neither field, and reads as "none".
  shiftTypeId: doc.shiftTypeId == null ? null : String(doc.shiftTypeId),
  // Round 24b: the palette's name — a Round-20 name the boot has not migrated yet reads as the one
  // it will be migrated to, so the board, the audit and the no-op test all see one spelling.
  rowColour: canonicalCrewRowColour(doc.rowColour),
});

/**
 * The board's view of a crew row — its id, then its facts, then (Round 32 critic) how many
 * محصنات ride it (`legs`, a `countLiveByCrew` answer for the day's rows).
 */
const toCrewDto = (
  doc: OperationsCrewAssignmentDoc,
  legs: ReadonlyMap<string, number>,
): OperationsCrewBoardCrewDto => ({
  // The id is spread in HERE rather than added to `snapshot`, which the audit diffs also use — an
  // entity's own id in its own change list is noise, since `entityRef.entityId` already carries it.
  id: String(doc._id),
  ...snapshot(doc),
  shipments: legs.get(String(doc._id)) ?? 0,
});

/** Everyone the payload row puts on the vehicle, across all three slots. */
const rowCrew = (row: PlanOperationsCrewRow): string[] => [
  ...(row.captainEmployeeIds ?? []),
  ...(row.specialist1EmployeeIds ?? []),
  ...(row.specialist2EmployeeIds ?? []),
];

/** A row that ASSIGNS something, as opposed to one that only clears or annotates. */
const assigns = (row: PlanOperationsCrewRow): boolean => rowCrew(row).length > 0;

/** The legacy default planning date: tomorrow (contad_app.js:2239-2247). */
const tomorrow = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
};

/** The order rows were added in — the board's order for the rows it does not order by roster. */
const byCreation = (a: OperationsCrewAssignmentDoc, b: OperationsCrewAssignmentDoc): number =>
  a.createdAt.getTime() - b.createdAt.getTime() || String(a._id).localeCompare(String(b._id));

/**
 * Vehicle codes in code order, numbers in number order («9» before «150»). Round 32: the contracts'
 * natural rule, a code that names nothing («0», «00» …) after every one that does.
 */
const byCode = byVehicleCodeNaturally;

/**
 * Round 32 — 422 `OPERATIONS_CREW_DAY_IN_PAST`: «لما بجيب السجل فى لوحة التشغيل بيخلى اعدل وانا
 * عاوزها اظهار فقط». A past day opens on the board as its record; nothing of it is written, whatever
 * a client sends. The detail names the earliest day allowed, as the distribution's does.
 */
export const crewDayInPast = (day: string, today: string): AppError =>
  new AppError(
    ErrorCodes.OPERATIONS_CREW_DAY_IN_PAST,
    422,
    `the day ${day} is before today (${today}) — a past day's crew board is its record, view only`,
    { details: [{ field: 'date', code: 'MIN_DATE', message: today }] },
  );

/**
 * A row that holds NOTHING — no people and no field: what a blank plan would not even create. A
 * ROSTER van's row emptied to this (and holding no leg) is a van with no crew (Round 24): the
 * «بدون سيارة» list offers it, and a row given it takes its place.
 */
const isBlankRow = (row: OperationsCrewAssignmentDoc): boolean =>
  crewMembers(row).length === 0 &&
  row.direction == null &&
  row.plannedTime == null &&
  row.notes == null &&
  row.shiftTypeId == null &&
  row.rowColour == null;

/** Does this saved row (if any) already hold exactly this van? */
const hasVanNamed = (row: OperationsCrewAssignmentDoc | undefined, vehicleId: string): boolean =>
  row !== undefined && hasVan(row) && String(row.vehicleId) === vehicleId;

/** Does this row carry any live leg, by a `countLiveByCrew` answer? */
const legsOn = (counts: ReadonlyMap<string, number>, row: OperationsCrewAssignmentDoc): boolean =>
  (counts.get(String(row._id)) ?? 0) > 0;

/** Where a row of the day sits, for a refusal: its van, or that it has none. */
const placeOf = (row: OperationsCrewAssignmentDoc): string =>
  hasVan(row) ? `vehicle ${String(row.vehicleId)}` : `the row without a vehicle ${String(row._id)}`;

const rowIndexDetail = (index: number) => ({
  field: 'rows',
  code: 'ROW_INDEX',
  message: String(index),
});

interface ChangedRow {
  crewAssignmentId: string;
  vehicleId: string | null;
  captainEmployeeIds: string[];
  specialist1EmployeeIds: string[];
  specialist2EmployeeIds: string[];
}

interface PendingAudit {
  entityId: string;
  action: 'create' | 'update' | 'delete';
  changes: ReturnType<typeof diffChanges>;
}

/** A row's next state, in `snapshot`'s key order. */
interface NextRow {
  captainEmployeeIds: string[];
  specialist1EmployeeIds: string[];
  specialist2EmployeeIds: string[];
  direction: string | null;
  plannedTime: string | null;
  notes: string | null;
  shiftTypeId: string | null;
  rowColour: OperationsCrewRowColour | null;
}

class OperationsCrewService {
  /**
   * The tashghela board: the Fleet duty rows for the date joined with the cash-crew rows — and,
   * since Round 20, each van's drivers by name, the day's rows WITHOUT a van, and the vans the
   * workshop holds that day.
   *
   * Round 24 — two more things. The vans a crew row holds that the Fleet roster does NOT have that
   * day are van rows too (after the roster's, in the order they were added; `fleetDutyAssignmentId`
   * null, no drivers). And `freeVehicles`: every active car with no crew row that day, for the
   * «بدون سيارة» cell («يجيب كل السيارات اللى مش عليها طاقم واقدر اختار منهم»).
   */
  async board(date: Date | undefined, now: Date = new Date()): Promise<OperationsCrewBoardDto> {
    const day = date === undefined ? tomorrow() : utcDay(date);
    // Round 32 — a day before today (Cairo) is the day's RECORD: read as any other, saved never.
    const today = cairoCalendarDate(now);
    const dayDoc = await operationsDayService.findByDate(day);
    const dutyRows = await fleetDutyAssignmentRepository.findForDate(day);
    const crewRows =
      dayDoc === null ? [] : await operationsCrewAssignmentRepository.findForDay(dayDoc._id);
    const vanRows = crewRows.filter(hasVan);
    const crewByVehicle = new Map(vanRows.map((row) => [String(row.vehicleId), row]));
    const dutyByVehicle = new Map(dutyRows.map((duty) => [String(duty.vehicleId), duty]));
    // The vans a crew row holds that the roster does not have today, in the order they were added.
    const offRoster = vanRows
      .filter((row) => !dutyByVehicle.has(String(row.vehicleId)))
      .sort(byCreation);

    const [fleet, standing, cashOperationIds, typeNames] = await Promise.all([
      fleetActiveVehicles(),
      operationsStandingCrewRepository.findAll(),
      settingsService.resolve<string[]>(
        OperationsSettingKeys.CashTransferOperationIds,
        ORG_SUBJECT,
      ),
      fleetVehicleTypeNames(),
    ]);
    // An unconfigured setting names NO vehicle here — "no filter" elsewhere means "every vehicle",
    // which is neither a workshop figure for this board nor a group of the free list.
    const designated = new Set(
      cashOperationIds.length === 0
        ? []
        : await fleetVehicleRepository.idsWithOperations(cashOperationIds),
    );
    const standingIds = new Set(standing.map((row) => String(row.vehicleId)));
    // A van is CREWED when a live row holds it — except a roster van whose row was emptied to
    // nothing and carries no leg: on the board that is a roster van with no crew, and a row given
    // it takes its place (`plan`). Everything else a row holds is not offered.
    const blankRoster = vanRows.filter(
      (row) => dutyByVehicle.has(String(row.vehicleId)) && isBlankRow(row),
    );
    const legsOnBlank = await operationsShipmentAssignmentRepository.countLiveByCrew(
      blankRoster.map((row) => String(row._id)),
    );
    const crewed = new Set(
      vanRows
        .filter((row) => !(blankRoster.includes(row) && !legsOn(legsOnBlank, row)))
        .map((row) => String(row.vehicleId)),
    );
    // Round 32 — «دى مشكلة بيظهر عربيات ايه الاصفار دى»: a car whose code and plate both name nothing
    // cannot be told from the next on a list — left out, and counted. Never a van already the
    // day's or Operations' own: a roster van (Fleet's for the day) and a standing-crew van are
    // always offered, as they are.
    const uncrewed = fleet.filter((car) => !crewed.has(car.vehicleId));
    const unidentified = uncrewed.filter(
      (car) =>
        !dutyByVehicle.has(car.vehicleId) && !standingIds.has(car.vehicleId) && isUnidentified(car),
    );
    const free = uncrewed.filter((car) => !unidentified.includes(car));

    // ONE Fleet read for every van's code, ONE directory read for every driver's name — the van
    // cards' own shape (shipment.service.ts `vanCardsOf`), rather than a read per row. ONE workshop
    // read for the «صيانة» figure and the free list together.
    // Round 32 critic — with its plate and type: a van whose code names nothing («0», «00» …) is
    // named on the board by its plate, as its «بدون سيارة» list named it (`uncoded`).
    const vehicleNames = await fleetVehicleRepository.namesByIds([
      ...dutyRows.map((duty) => String(duty.vehicleId)),
      ...offRoster.map((row) => String(row.vehicleId)),
    ]);
    const codeOfVan = (vehicleId: string): string => vehicleNames.get(vehicleId)?.code ?? vehicleId;
    const uncodedOfVan = (vehicleId: string) => {
      const named = vehicleNames.get(vehicleId);
      return named === undefined
        ? null
        : uncodedOf(
            { vehicleCode: named.code, plateNumber: named.plateNumber, typeId: named.typeId },
            typeNames,
          );
    };
    // Round 32 critic — the محصنات each of the day's rows holds: they ride the row, and the board's
    // «تبديل بين سيارتين» says how many before a captain or a direction leaves it. ONE read.
    const legsByCrew = await operationsShipmentAssignmentRepository.countLiveByCrew(
      crewRows.map((row) => String(row._id)),
    );
    // `!= null`, not `!== null`: a `.lean()` row hands an absent field back as `undefined`, and
    // `String(undefined)` would name a driver "undefined".
    const driverIdsOf = (duty: (typeof dutyRows)[number]): string[] =>
      [duty.driver1EmployeeId, duty.driver2EmployeeId].filter((id) => id != null).map(String);
    const drivers = await getDirectoryEmployees([...new Set(dutyRows.flatMap(driverIdsOf))]);
    // «ولما اعمل هوفر على العربيه يظهر السواقيين اللى عليها» — by NAME only, field by field so no
    // code or phone can ride along: a driver's details are Fleet's (the round-5 rule).
    const driverNames = (duty: (typeof dutyRows)[number]) =>
      driverIdsOf(duty).map((employeeId) => ({
        employeeId,
        fullNameAr: drivers.get(employeeId)?.fullNameAr ?? null,
      }));

    const workshopCandidates = [
      ...dutyRows.map((duty) => String(duty.vehicleId)),
      ...offRoster.map((row) => String(row.vehicleId)),
      ...standingIds,
      ...designated,
    ];
    const inWorkshop = await fleetVehiclesInWorkshop(
      [...new Set([...workshopCandidates, ...free.map((car) => car.vehicleId)])],
      day,
    );

    const rows: OperationsCrewBoardRowDto[] = [
      ...dutyRows.map((duty): OperationsCrewBoardRowDto => {
        const crew = crewByVehicle.get(String(duty.vehicleId));
        return {
          vehicleId: String(duty.vehicleId),
          vehicleCode: codeOfVan(String(duty.vehicleId)),
          fleetDutyAssignmentId: String(duty._id),
          driver1EmployeeId:
            duty.driver1EmployeeId == null ? null : String(duty.driver1EmployeeId),
          driver2EmployeeId:
            duty.driver2EmployeeId == null ? null : String(duty.driver2EmployeeId),
          drivers: driverNames(duty),
          missionTypeId: duty.missionTypeId == null ? null : String(duty.missionTypeId),
          crew: crew === undefined ? null : toCrewDto(crew, legsByCrew),
          uncoded: uncodedOfVan(String(duty.vehicleId)),
        };
      }),
      // Round 24 — a van given on this board that the roster does not have: no Fleet facts at all.
      ...offRoster.map((row): OperationsCrewBoardRowDto => ({
        vehicleId: String(row.vehicleId),
        vehicleCode: codeOfVan(String(row.vehicleId)),
        fleetDutyAssignmentId: null,
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        drivers: [],
        missionTypeId: null,
        crew: toCrewDto(row, legsByCrew),
        uncoded: uncodedOfVan(String(row.vehicleId)),
      })),
    ];

    // The rows without a van, in the order they were added — the board lists them after the vans.
    const vehiclelessRows = crewRows
      .filter((row) => !hasVan(row))
      .sort(byCreation)
      .map((row) => toCrewDto(row, legsByCrew));

    // «صيانة» — Operations' own vans only, never the whole fleet (a company-wide workshop count
    // would be noise on a cash board): the day's vans (roster, and a crew row's off the roster),
    // the standing crew's vans (the explicit «this is a cash-transfer vehicle» Operations keeps),
    // and — when the cash-transfer التشغيل is configured — every vehicle Fleet runs as one. Legacy
    // counted exactly this kind of van: its board read the day's locked vans and set the ones in
    // maintenance aside (contad_app.js:2255-2263).
    const inWorkshopToday = [...new Set(workshopCandidates)].filter((id) => inWorkshop.has(id));
    const workshopCodes = await fleetVehicleRepository.codesByIds(inWorkshopToday);
    const workshopVehicles = inWorkshopToday
      .map((vehicleId) => ({ vehicleId, vehicleCode: workshopCodes.get(vehicleId) ?? vehicleId }))
      .sort((a, b) => byCode(a.vehicleCode, b.vehicleCode));

    // «بدون سيارة … يجيب كل السيارات اللى مش عليها طاقم»: every active car no crew row holds today —
    // on the roster first, then the cash-transfer operations', then the standing crew's, then the
    // rest; each group by code, numbers in number order.
    // Round 32: a car whose code names nothing is listed LAST, by its plate — unless it is the
    // day's roster van or the standing crew's, which keep their group (named by their plate too).
    const groupOf = (vehicleId: string, uncoded: boolean): OperationsCrewFreeVehicleGroup =>
      dutyByVehicle.has(vehicleId)
        ? 'roster'
        : uncoded && !standingIds.has(vehicleId)
          ? 'uncoded'
          : designated.has(vehicleId)
            ? 'cashTransfer'
            : standingIds.has(vehicleId)
              ? 'standing'
              : 'other';
    const freeVehicles = free
      .map((car): OperationsCrewBoardFreeVehicleDto => {
        const duty = dutyByVehicle.get(car.vehicleId);
        const uncoded = uncodedOf(car, typeNames);
        return {
          vehicleId: car.vehicleId,
          vehicleCode: car.vehicleCode,
          group: groupOf(car.vehicleId, uncoded !== null),
          onRoster: duty !== undefined,
          inWorkshop: inWorkshop.has(car.vehicleId),
          drivers: duty === undefined ? [] : driverNames(duty),
          uncoded,
        };
      })
      .sort(
        (a, b) =>
          OPERATIONS_CREW_FREE_VEHICLE_GROUPS.indexOf(a.group) -
            OPERATIONS_CREW_FREE_VEHICLE_GROUPS.indexOf(b.group) ||
          // Round 32 critic — two uncoded cars by their PLATE (their zeros say nothing).
          byCarForPicker(a, b) ||
          a.vehicleId.localeCompare(b.vehicleId),
      );

    return {
      date: day.toISOString(),
      today: today.toISOString(),
      past: ymdOf(day) < ymdOf(today),
      day:
        dayDoc === null
          ? null
          : {
              id: String(dayDoc._id),
              date: dayDoc.date.toISOString(),
              status: dayDoc.status,
              openedById: dayDoc.openedById === null ? null : String(dayDoc.openedById),
              openedAt: dayDoc.openedAt === null ? null : dayDoc.openedAt.toISOString(),
              closedById: dayDoc.closedById === null ? null : String(dayDoc.closedById),
              closedAt: dayDoc.closedAt === null ? null : dayDoc.closedAt.toISOString(),
              version: dayDoc.__v,
              createdAt: dayDoc.createdAt.toISOString(),
              updatedAt: dayDoc.updatedAt.toISOString(),
            },
      rows,
      vehiclelessRows,
      workshopVehicles,
      freeVehicles,
      unidentifiedVehicles: unidentified.length,
    };
  }

  async plan(
    input: PlanOperationsCrew,
    by: string,
    now: Date = new Date(),
  ): Promise<{ changedCount: number }> {
    const day = utcDay(input.date);
    // Round 32 — «لما بجيب السجل فى لوحة التشغيل بيخلى اعدل وانا عاوزها اظهار فقط»: a past day is its
    // record, read only on the server too — refused before anything is read or written.
    if (ymdOf(day) < cairoYmd(now)) throw crewDayInPast(ymdOf(day), cairoYmd(now));
    const removals = input.removeCrewAssignmentIds ?? [];

    // §9.4 anchor — a planned van on the Fleet roster for the date anchors on that roster row (the
    // legacy car_lock gate, normalized). Resolved OUTSIDE the transaction: Fleet owns these rows.
    //
    // ROUND 24 — the roster is no longer the only door: «مكان بدون سيارة دا لما ادوس عليه يجيب كل
    // السيارات اللى مش عليها طاقم واقدر اختار منهم». A van the roster does NOT have that day may be
    // given to a row too — an ACTIVE car, not in the workshop that day (asked of Fleet here, once,
    // for every such van the save names; judged per row inside, against what the row already
    // holds). Such a row anchors on nothing (`fleetDutyAssignmentId` null).
    const dutyRows = await fleetDutyAssignmentRepository.findForDate(day);
    const dutyByVehicle = new Map(dutyRows.map((row) => [String(row.vehicleId), row]));
    const offRosterVans = [
      ...new Set(
        input.rows.flatMap((row) =>
          row.vehicleId !== null && !dutyByVehicle.has(row.vehicleId) ? [row.vehicleId] : [],
        ),
      ),
    ];
    const [activeVans, vansInWorkshop] =
      offRosterVans.length === 0
        ? [new Map<string, string>(), new Set<string>() as ReadonlySet<string>]
        : await Promise.all([
            fleetActiveVehiclesByIds(offRosterVans),
            fleetVehiclesInWorkshop(offRosterVans, day),
          ]);

    // Reference integrity for the normalized employee ids, through the directory seam (the fleet
    // driver-profile precedent): existence and not-exited. Attendance (Round 22) and the role a
    // slot takes (Round 23) are asked separately, below; no department or other flag is checked.
    const people = [...new Set(input.rows.flatMap(rowCrew))];
    for (const employeeId of people) {
      const employee = await getDirectoryEmployee(employeeId);
      if (employee === null) {
        throw new ValidationError([
          { field: 'body.rows', code: 'UNKNOWN', message: `employee ${employeeId} not found` },
        ]);
      }
      if (employee.status === 'exited') {
        throw new ConflictError(`employee ${employeeId} has exited and cannot be assigned`);
      }
    }

    // Round 22: who of the save's people HR has away on the day — the pool's own answer
    // (`crewAvailabilityOn`), read once and outside the transaction: HR owns these facts.
    // Round 23: what each of them IS — captain, specialist, or both — in ONE read of «متطلبات
    // الطاقم» for all of them, never one per person.
    const [away, roles] = await Promise.all([
      crewAvailabilityOn(people, day),
      crewRolesOf(people),
    ]);

    const dayDoc = await operationsDayService.ensureForDate(day, by);

    const outcome = await unitOfWork(async (session) => {
      const existing = await operationsCrewAssignmentRepository.findForDay(dayDoc._id, session);
      const byVehicle = new Map(
        existing.filter(hasVan).map((row) => [String(row.vehicleId), row]),
      );
      const byId = new Map(existing.map((row) => [String(row._id), row]));

      // A SAVED ROW addressed by its own id must be a live row of THIS day.
      const liveRow = (id: string): OperationsCrewAssignmentDoc => {
        const row = byId.get(id);
        if (row === undefined) {
          throw new NotFoundError(`crew row ${id} is not a live row of this day`);
        }
        return row;
      };
      // A row WITHOUT A VAN is addressed by its own id for an edit — a van's row by its van.
      const vehiclelessRow = (id: string): OperationsCrewAssignmentDoc => {
        const row = liveRow(id);
        if (hasVan(row)) {
          throw new BusinessRuleError(
            `crew row ${id} is a van's row — it is addressed by its vehicle (crewAssignmentId)`,
          );
        }
        return row;
      };
      // WHAT MAY BE REMOVED: a row without a van, and (Round 24) a van's row whose van the Fleet
      // roster does NOT have today — it exists only because this board gave it the van, and
      // removing it frees the van. A ROSTER van's row is emptied, never removed: the van is Fleet's
      // roster for the day, not this board's to drop.
      const removable = (id: string): OperationsCrewAssignmentDoc => {
        const row = liveRow(id);
        if (hasVan(row) && dutyByVehicle.has(String(row.vehicleId))) {
          throw new BusinessRuleError(
            `crew row ${id} is the row of a van on the Fleet roster — it is emptied, never removed (removeCrewAssignmentIds)`,
          );
        }
        return row;
      };
      const removed = removals.map(removable);
      const removedIds = new Set(removed.map((row) => String(row._id)));

      // ROUND 24 — A ROW THAT HOLDS محصنات IS NOT REMOVED. Its live legs (placed on «توزيع المحصنات»,
      // delivered or not) ride THIS row: removed, they would point at a row nobody sees — off every
      // van card, still on a captain's route he may no longer execute. Take them off first, or give
      // the row a van instead (it keeps its id and its legs). Emptying a row stays allowed, van or
      // none, exactly as a van's row always was: the legs stay on the row with the captain they name.
      const legsOnRemoved = await operationsShipmentAssignmentRepository.countLiveByCrew(
        [...removedIds],
        session,
      );
      removals.forEach((id, index) => {
        const count = legsOnRemoved.get(id) ?? 0;
        if (count === 0) return;
        throw new AppError(
          ErrorCodes.OPERATIONS_CREW_ROW_HAS_SHIPMENTS,
          409,
          `crew row ${id} holds ${String(count)} shipment leg(s) and cannot be removed`,
          {
            details: [
              { field: 'crewAssignmentId', code: 'CREW_ROW', message: id },
              { field: 'shipments', code: 'COUNT', message: String(count) },
              { field: 'removeCrewAssignmentIds', code: 'REMOVAL_INDEX', message: String(index) },
            ],
          },
        );
      });

      // The saved row each payload row lands on; undefined for a new one. A ROSTER van's row with no
      // id is the live row holding that van, as it always was (the van's row, upserted by van) —
      // unless that row is removed in this same save, which frees the van for a NEW row.
      //
      // A van OFF the roster with no id is ALWAYS a new row (Round 24, the critic's two-desk case):
      // such a van has a row only because some desk gave it one, and the board names every saved
      // row by its id — so a payload that names none believes the van free. If another desk crewed
      // it since, the van is TAKEN (409, below), never that desk's row silently overwritten.
      const currentOf = input.rows.map((row): OperationsCrewAssignmentDoc | undefined => {
        if (row.crewAssignmentId !== undefined) {
          if (row.vehicleId === null) return vehiclelessRow(row.crewAssignmentId);
          // Round 24 — «X takes V», or X's plain edit when it already holds V.
          const saved = liveRow(row.crewAssignmentId);
          if (hasVan(saved) && String(saved.vehicleId) !== row.vehicleId) {
            throw new BusinessRuleError(
              `crew row ${row.crewAssignmentId} holds another van — a van's row does not change van`,
            );
          }
          return saved;
        }
        if (row.vehicleId === null || !dutyByVehicle.has(row.vehicleId)) return undefined;
        const holder = byVehicle.get(row.vehicleId);
        return holder === undefined || removedIds.has(String(holder._id)) ? undefined : holder;
      });
      // Does this payload row put a van on a row that did not hold it — a new van row, or a saved
      // row without a van given one? Those, and only those, are asked about the van below.
      const takesVan = input.rows.map(
        (row, index) => row.vehicleId !== null && !hasVanNamed(currentOf[index], row.vehicleId),
      );

      // ROUND 24 — THE VAN, where a row newly takes one. On the roster: anchored on its roster row,
      // Fleet's decision, as before. Off the roster: an ACTIVE car that the workshop does not hold
      // that day. Either way, no OTHER live row may hold it at the end of the save (`ux_day_vehicle`
      // — one van, one row a day); a row removed in this save holds nothing, and neither does a
      // ROSTER van's row emptied to nothing that carries no leg — the board shows that van with no
      // crew, «بدون سيارة» offers it, and it is RELEASED (deleted) in this save for the row taking
      // the van. Every other holder → 409 `OPERATIONS_CREW_VEHICLE_TAKEN`.
      const holderOf = (vehicleId: string): OperationsCrewAssignmentDoc | undefined => {
        const holder = byVehicle.get(vehicleId);
        return holder === undefined || removedIds.has(String(holder._id)) ? undefined : holder;
      };
      const blankHolders = input.rows.flatMap((row, index) => {
        if (!takesVan[index] || row.vehicleId === null) return [];
        const holder = holderOf(row.vehicleId);
        return holder !== undefined && dutyByVehicle.has(row.vehicleId) && isBlankRow(holder)
          ? [holder]
          : [];
      });
      const legsOnBlank = await operationsShipmentAssignmentRepository.countLiveByCrew(
        blankHolders.map((row) => String(row._id)),
        session,
      );
      const released: OperationsCrewAssignmentDoc[] = [];
      input.rows.forEach((row, index) => {
        if (!takesVan[index] || row.vehicleId === null) return;
        const vehicleId = row.vehicleId;
        if (!dutyByVehicle.has(vehicleId)) {
          if (!activeVans.has(vehicleId)) {
            throw new AppError(
              ErrorCodes.OPERATIONS_CREW_VEHICLE_NOT_ACTIVE,
              422,
              `vehicle ${vehicleId} is not an active vehicle of the fleet`,
              {
                details: [
                  { field: 'vehicleId', code: 'NOT_ACTIVE', message: vehicleId },
                  rowIndexDetail(index),
                ],
              },
            );
          }
          if (vansInWorkshop.has(vehicleId)) {
            throw new AppError(
              ErrorCodes.OPERATIONS_CREW_VEHICLE_IN_WORKSHOP,
              422,
              `vehicle ${vehicleId} is in the workshop on this day`,
              {
                details: [
                  { field: 'vehicleId', code: 'IN_WORKSHOP', message: vehicleId },
                  rowIndexDetail(index),
                ],
              },
            );
          }
        }
        const holder = holderOf(vehicleId);
        if (holder !== undefined && blankHolders.includes(holder) && !legsOn(legsOnBlank, holder)) {
          released.push(holder);
          return;
        }
        if (holder !== undefined) {
          throw new AppError(
            ErrorCodes.OPERATIONS_CREW_VEHICLE_TAKEN,
            409,
            `vehicle ${vehicleId} is held by another crew row of this day (${String(holder._id)})`,
            {
              details: [
                { field: 'vehicleId', code: 'TAKEN', message: vehicleId },
                { field: 'crewAssignmentId', code: 'CREW_ROW', message: String(holder._id) },
                rowIndexDetail(index),
              ],
            },
          );
        }
      });
      // The seats a row already holds — what the round-22 and round-23 rules let stay unchecked. A
      // saved row GIVEN A VAN holds none: «a row without a van given a van counts as new seats»,
      // exactly as when the board moved its crew onto the van's row (Round 20).
      const seatedOf = currentOf.map((current, index) => (takesVan[index] ? undefined : current));

      // Q11, checked against the END STATE of the whole day (the fleet FR-7 shape): a row outside
      // the payload still holding a payload crew member means the plan forgot the releasing row —
      // the client must send BOTH sides of a move, exactly what a drag produces. A row REMOVED in
      // this save releases its people, and a row WITHOUT A VAN holds them like any other (Round 20).
      const touched = new Set([
        ...removed.map((row) => String(row._id)),
        ...currentOf.flatMap((row) => (row === undefined ? [] : [String(row._id)])),
      ]);
      const payloadCrew = new Set(input.rows.flatMap(rowCrew));
      for (const row of existing) {
        if (touched.has(String(row._id))) continue;
        // The Q11 traversal widened with the slots — the rule did not. Reusing the repository's
        // `takenCrew` here would be wrong: it answers over a WHOLE day and this asks about one
        // untouched row, so the two stay separate implementations of the same rule.
        for (const occupant of crewMembers(row)) {
          if (payloadCrew.has(occupant)) {
            throw new ConflictError(
              `employee ${occupant} already holds this day's crew assignment on ${placeOf(row)} (Q11); include that row to release them`,
            );
          }
        }
      }

      // ROUND 22 — «لو القائد غايب ... مقدرش احطه على العربيه و كذلك الاخصائيين»: nobody HR has away
      // that day (absent, or on leave) is NEWLY put on a row. Somebody ALREADY on that row before
      // this save passes unchecked — planned before HR recorded the absence — exactly as a row keeps
      // a type it already holds, so the planner can still save the row's other changes and take the
      // person off when he chooses. "That row" is the row itself: a person moved from another row,
      // a row without a van given a van included, is being put on a van, which is what the owner
      // forbids for somebody away. Refused per ROW, so the board marks the row that placed him.
      input.rows.forEach((row, index) => {
        const current = seatedOf[index];
        const already = new Set(current === undefined ? [] : crewMembers(current));
        for (const employeeId of rowCrew(row)) {
          const availability = away.get(employeeId);
          if (availability === undefined || already.has(employeeId)) continue;
          throw new AppError(
            ErrorCodes.OPERATIONS_CREW_MEMBER_ABSENT,
            422,
            `employee ${employeeId} is ${availability === 'absent' ? 'absent' : 'on leave'} on this day and cannot be put on a crew row`,
            {
              details: [
                {
                  field: 'employeeId',
                  code: availability === 'absent' ? 'ABSENT' : 'ON_LEAVE',
                  message: employeeId,
                },
                rowIndexDetail(index),
              ],
            },
          );
        }
      });

      // ROUND 23 — «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى»: nobody is
      // NEWLY put in a slot his role does not fit (`refuseWrongSlots`). Somebody ALREADY in that SAME
      // slot of that SAME row before this save passes unchecked — seated before this rule, or
      // before «متطلبات الطاقم» changed his flags — as an archived type stays on the row that holds
      // it and a person marked absent after he was planned keeps his seat: the planner can still
      // save the row's other changes, and the board marks the seat until he is taken out. Another
      // slot of the row, another row, or a row without a van given a van is a new seat, held to
      // the rule. Refused per ROW, so the board rings him on the row that placed him.
      refuseWrongSlots(input.rows, roles, (index, slot) => {
        const current = seatedOf[index];
        return current === undefined ? [] : slotIds(current[CREW_SLOT_FIELD[slot]]);
      });

      // WHAT A ROW MAY KEEP WITHOUT A CHECK — its own saved type and direction, or those of a row
      // removed in the same save (a row without a van given a van carries them onto the van's
      // row: the same value, moved, not a new choice). Anything else is a new choice and is held
      // to today's catalog.
      const carriedTypes = new Set(
        removed.flatMap((row) => (row.shiftTypeId == null ? [] : [String(row.shiftTypeId)])),
      );
      const carriedDirections = new Set(
        removed.flatMap((row) => (row.direction === null ? [] : [row.direction])),
      );

      // Per ROW, not per id: one row may keep an archived type while another newly picks the same
      // one, and the refusal must name the row that picked it — the board marks that row red.
      const newTypeOf = input.rows.map((row, index): string | null => {
        const chosen = row.shiftTypeId ?? null;
        const current = currentOf[index];
        const held = current?.shiftTypeId == null ? null : String(current.shiftTypeId);
        return chosen === null || chosen === held || carriedTypes.has(chosen) ? null : chosen;
      });
      const newTypeIds = [
        ...new Set(newTypeOf.filter((chosen): chosen is string => chosen !== null)),
      ];
      const activeTypes = new Set(
        (await operationsShiftTypeRepository.findLiveByIds(newTypeIds))
          .filter((type) => type.isActive)
          .map((type) => String(type._id)),
      );
      newTypeOf.forEach((chosen, index) => {
        if (chosen === null || activeTypes.has(chosen)) return;
        throw new AppError(
          ErrorCodes.OPERATIONS_UNKNOWN_SHIFT_TYPE,
          422,
          `shift type ${chosen} is not an active type of the catalog`,
          {
            details: [
              { field: 'shiftTypeId', code: 'SHIFT_TYPE', message: chosen },
              rowIndexDetail(index),
            ],
          },
        );
      });

      // «الاتجاه» — Round 28: typed by hand when no area answers it («عاوز الاتجاه اقدر اكتبه بايدى لو
      // مش موجود فى الليست»), an area's name still respelled as the area spells it. Unchanged —
      // the row's own, or one a removed row carries over — is kept exactly as written, an old
      // free-text direction included (`crew-direction.ts`). The areas are read once, and only
      // when some row brings a new direction.
      const directionOf = directionResolver();

      const changed: ChangedRow[] = [];
      const audits: PendingAudit[] = [];
      const legAudits: LegVanChange[] = [];

      // The van a row newly takes, anchored on its roster row when the roster has it — and, since
      // Round 24, on nothing when it does not.
      const anchorOf = (
        vehicleId: string | null,
      ): { vehicleId: Types.ObjectId | null; fleetDutyAssignmentId: Types.ObjectId | null } =>
        vehicleId === null
          ? { vehicleId: null, fleetDutyAssignmentId: null }
          : {
              vehicleId: new Types.ObjectId(vehicleId),
              fleetDutyAssignmentId: dutyByVehicle.get(vehicleId)?._id ?? null,
            };

      // REMOVALS FIRST — a row without a van, or a van's row off the roster, deleted (soft: the
      // audit trail and any reader by id keep it). Its people — and its van — are free for the rows
      // below (`ux_day_vehicle` counts live rows only); the event reports its slots emptied.
      for (const row of removed) {
        await operationsCrewAssignmentRepository.softDeleteById(String(row._id), { by, session });
        audits.push({
          entityId: String(row._id),
          action: 'delete',
          changes: diffChanges(snapshot(row), {}),
        });
        changed.push({
          crewAssignmentId: String(row._id),
          vehicleId: vehicleIdOf(row),
          captainEmployeeIds: [],
          specialist1EmployeeIds: [],
          specialist2EmployeeIds: [],
        });
      }
      // Round 24 — a roster van's EMPTY row, released for the row taking its van (see above): the
      // same soft delete as a removal, so `ux_day_vehicle` frees the van for the writes below.
      for (const row of released) {
        await operationsCrewAssignmentRepository.softDeleteById(String(row._id), { by, session });
        audits.push({
          entityId: String(row._id),
          action: 'delete',
          changes: diffChanges(snapshot(row), {}),
        });
        changed.push({
          crewAssignmentId: String(row._id),
          vehicleId: vehicleIdOf(row),
          captainEmployeeIds: [],
          specialist1EmployeeIds: [],
          specialist2EmployeeIds: [],
        });
      }

      for (const [index, row] of input.rows.entries()) {
        const current = currentOf[index];
        // An omitted slot or field CLEARS it, unchanged from when a slot held one person: the
        // board sends whole rows, and `undefined` has always meant "nobody", never "keep what is
        // there". A partial-update dialect would be a new behaviour, and no slice introduced one.
        const next: NextRow = {
          captainEmployeeIds: row.captainEmployeeIds ?? [],
          specialist1EmployeeIds: row.specialist1EmployeeIds ?? [],
          specialist2EmployeeIds: row.specialist2EmployeeIds ?? [],
          direction: await directionOf(
            row.direction,
            [current?.direction, ...carriedDirections],
            index,
          ),
          plannedTime: row.plannedTime ?? null,
          notes: row.notes ?? null,
          shiftTypeId: row.shiftTypeId ?? null,
          rowColour: row.rowColour ?? null,
        };
        const set: Partial<OperationsCrewAssignmentDoc> = {
          captainEmployeeIds: next.captainEmployeeIds.map((id) => new Types.ObjectId(id)),
          specialist1EmployeeIds: next.specialist1EmployeeIds.map((id) => new Types.ObjectId(id)),
          specialist2EmployeeIds: next.specialist2EmployeeIds.map((id) => new Types.ObjectId(id)),
          direction: next.direction,
          plannedTime: next.plannedTime,
          notes: next.notes,
          shiftTypeId: next.shiftTypeId === null ? null : new Types.ObjectId(next.shiftTypeId),
          rowColour: next.rowColour,
        };

        let doc: OperationsCrewAssignmentDoc;
        if (current === undefined) {
          // An empty plan for a row that does not exist is nothing — the fleet roster rule, for a
          // roster van with no row and for a row without a van added and left blank alike. A van
          // OFF the roster is not blank (Round 24): the van is the row's content — the board lists
          // it only because a row holds it.
          const blank =
            !assigns(row) &&
            next.direction === null &&
            next.plannedTime === null &&
            next.notes === null &&
            next.shiftTypeId === null &&
            next.rowColour === null &&
            (row.vehicleId === null || dutyByVehicle.has(row.vehicleId));
          if (blank) continue;
          const anchor = anchorOf(row.vehicleId);
          doc = await operationsCrewAssignmentRepository.create(
            { operationsDayId: dayDoc._id, ...anchor, ...set },
            { by, session },
          );
          audits.push({
            entityId: String(doc._id),
            action: 'create',
            changes: diffChanges({}, snapshot(doc)),
          });
        } else if (takesVan[index] && row.vehicleId !== null) {
          // ROUND 24 — «X TAKES V»: the SAME crew row is given the van (its id, and so every leg
          // and screen addressed by it, unchanged), and in the same transaction its live legs take
          // the van too — a leg copies its row's van (legacy `car_num1/2`), and the captain's app,
          // the boards and the reports read it there. Each leg's van change is audited on the leg,
          // so «السجل» of its shipment shows it like any other van change (`crewChanged`).
          const anchor = anchorOf(row.vehicleId);
          const before = snapshot(current);
          doc = await operationsCrewAssignmentRepository.updateById(
            String(current._id),
            { ...set, ...anchor },
            { by, version: current.__v, session },
          );
          audits.push({
            entityId: String(doc._id),
            action: 'update',
            changes: diffChanges(
              { vehicleId: vehicleIdOf(current), ...before },
              { vehicleId: vehicleIdOf(doc), ...snapshot(doc) },
            ),
          });
          legAudits.push(
            ...(await moveRowLegsToVan(String(current._id), anchor.vehicleId, { by, session })),
          );
        } else {
          const before = snapshot(current);
          if (JSON.stringify(before) === JSON.stringify(next)) continue;
          doc = await operationsCrewAssignmentRepository.updateById(String(current._id), set, {
            by,
            version: current.__v,
            session,
          });
          audits.push({
            entityId: String(doc._id),
            action: 'update',
            changes: diffChanges(before, snapshot(doc)),
          });
        }
        changed.push({
          crewAssignmentId: String(doc._id),
          vehicleId: vehicleIdOf(doc),
          captainEmployeeIds: next.captainEmployeeIds,
          specialist1EmployeeIds: next.specialist1EmployeeIds,
          specialist2EmployeeIds: next.specialist2EmployeeIds,
        });
      }
      return { changed, audits, legAudits };
    });

    // Audit + events only after the transaction has committed (roster.service.ts:272).
    for (const audit of outcome.audits) {
      await auditService.record({
        entityRef: entityRef(audit.entityId),
        action: audit.action,
        changes: audit.changes,
      });
    }
    // Round 24 — each leg that took its row's new van: audited ON THE LEG (the shipment's «السجل»
    // reads it as a van change) and announced like any other leg assignment (assignments/leg-van.ts).
    await recordLegVanChanges(outcome.legAudits);
    for (const row of outcome.changed) {
      await emit(OperationsEvents.CrewAssignmentChanged, {
        dayId: String(dayDoc._id),
        crewAssignmentId: row.crewAssignmentId,
        vehicleId: row.vehicleId,
        date: day,
        captainEmployeeIds: row.captainEmployeeIds,
        specialist1EmployeeIds: row.specialist1EmployeeIds,
        specialist2EmployeeIds: row.specialist2EmployeeIds,
      });
    }
    await emit(OperationsEvents.CrewPlanned, {
      dayId: String(dayDoc._id),
      date: day,
      changedCount: outcome.changed.length,
    });
    return { changedCount: outcome.changed.length };
  }
}

export const operationsCrewService = new OperationsCrewService();
