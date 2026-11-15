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
//     البنوك»: a new or changed direction must name active operations areas, and is stored in their
//     own spelling. One saved before, legacy free text included, stays while it is sent unchanged.
//   · The van's drivers by name on the board, and the day's vans in the workshop («صيانة»).
import {
  ErrorCodes,
  OperationsEvents,
  OperationsSettingKeys,
  canonicalOperationsDirection,
  type OperationsCrewBoardCrewDto,
  type OperationsCrewBoardDto,
  type OperationsCrewBoardRowDto,
  type OperationsCrewBoardWorkshopVehicleDto,
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
  fleetDutyAssignmentRepository,
  fleetVehicleRepository,
  fleetVehiclesInWorkshop,
} from '../fleet-boundary';
import { operationsDayService, utcDay } from '../days/day.service';
import { operationsAreaRepository } from '../areas/area.repository';
import { operationsShiftTypeRepository } from '../shift-types/shift-type.repository';
import { operationsStandingCrewRepository } from '../standing-crew/standing-crew.repository';
import { operationsCrewAssignmentRepository } from './crew-assignment.repository';
import { hasVan, type OperationsCrewAssignmentDoc } from './crew-assignment.model';
import { crewMembers, slotIds } from './crew-slots';
import { crewAvailabilityOn } from './crew-requirements.service';
import { CREW_SLOT_FIELD, crewRolesOf, refuseWrongSlots } from './crew-roles';

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
  rowColour: doc.rowColour ?? null,
});

/** The board's view of a crew row — its id, then its facts. */
const toCrewDto = (doc: OperationsCrewAssignmentDoc): OperationsCrewBoardCrewDto => ({
  // The id is spread in HERE rather than added to `snapshot`, which the audit diffs also use — an
  // entity's own id in its own change list is noise, since `entityRef.entityId` already carries it.
  id: String(doc._id),
  ...snapshot(doc),
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
   */
  async board(date: Date | undefined): Promise<OperationsCrewBoardDto> {
    const day = date === undefined ? tomorrow() : utcDay(date);
    const dayDoc = await operationsDayService.findByDate(day);
    const dutyRows = await fleetDutyAssignmentRepository.findForDate(day);
    const crewRows =
      dayDoc === null ? [] : await operationsCrewAssignmentRepository.findForDay(dayDoc._id);
    const crewByVehicle = new Map(
      crewRows.filter(hasVan).map((row) => [String(row.vehicleId), row]),
    );

    // ONE Fleet read for every van's code, ONE directory read for every driver's name — the van
    // cards' own shape (shipment.service.ts `vanCardsOf`), rather than a read per row.
    const vehicleCodes = await fleetVehicleRepository.codesByIds(
      dutyRows.map((duty) => String(duty.vehicleId)),
    );
    // `!= null`, not `!== null`: a `.lean()` row hands an absent field back as `undefined`, and
    // `String(undefined)` would name a driver "undefined".
    const driverIdsOf = (duty: (typeof dutyRows)[number]): string[] =>
      [duty.driver1EmployeeId, duty.driver2EmployeeId].filter((id) => id != null).map(String);
    const drivers = await getDirectoryEmployees([...new Set(dutyRows.flatMap(driverIdsOf))]);

    const rows: OperationsCrewBoardRowDto[] = dutyRows.map((duty) => {
      const crew = crewByVehicle.get(String(duty.vehicleId));
      return {
        vehicleId: String(duty.vehicleId),
        vehicleCode: vehicleCodes.get(String(duty.vehicleId)) ?? String(duty.vehicleId),
        fleetDutyAssignmentId: String(duty._id),
        driver1EmployeeId:
          duty.driver1EmployeeId == null ? null : String(duty.driver1EmployeeId),
        driver2EmployeeId:
          duty.driver2EmployeeId == null ? null : String(duty.driver2EmployeeId),
        // «ولما اعمل هوفر على العربيه يظهر السواقيين اللى عليها» — by NAME only, field by field so
        // no code or phone can ride along: a driver's details are Fleet's (the round-5 rule).
        drivers: driverIdsOf(duty).map((employeeId) => ({
          employeeId,
          fullNameAr: drivers.get(employeeId)?.fullNameAr ?? null,
        })),
        missionTypeId: duty.missionTypeId == null ? null : String(duty.missionTypeId),
        crew: crew === undefined ? null : toCrewDto(crew),
      };
    });

    // The rows without a van, in the order they were added — the board lists them after the vans.
    const vehiclelessRows = crewRows
      .filter((row) => !hasVan(row))
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || String(a._id).localeCompare(String(b._id)),
      )
      .map(toCrewDto);

    return {
      date: day.toISOString(),
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
      workshopVehicles: await this.workshopVehicles(
        day,
        dutyRows.map((duty) => String(duty.vehicleId)),
      ),
    };
  }

  /**
   * «صيانة» — the day's vans in a Fleet workshop visit, asked of Fleet's own seam
   * (`fleetVehiclesInWorkshop`, the open-visit answer Fleet's roster plans by).
   *
   * WHICH VANS ARE ASKED ABOUT — Operations' own, never the whole fleet (a company-wide workshop
   * count would be noise on a cash board): the day's duty-row vans, the standing crew's vans (the
   * explicit «this is a cash-transfer vehicle» Operations keeps), and — when the cash-transfer
   * التشغيل is configured — every vehicle Fleet runs as one. Legacy counted exactly this kind of
   * van: its board read the day's locked vans and set the ones in maintenance aside
   * (contad_app.js:2255-2263). An unconfigured setting adds nothing here — "no filter" there means
   * "every vehicle", which is the noise this list must not be.
   */
  private async workshopVehicles(
    day: Date,
    dutyVehicleIds: readonly string[],
  ): Promise<OperationsCrewBoardWorkshopVehicleDto[]> {
    const [standing, cashOperationIds] = await Promise.all([
      operationsStandingCrewRepository.findAll(),
      settingsService.resolve<string[]>(OperationsSettingKeys.CashTransferOperationIds, ORG_SUBJECT),
    ]);
    const designated =
      cashOperationIds.length === 0
        ? []
        : await fleetVehicleRepository.idsWithOperations(cashOperationIds);
    const candidates = [
      ...new Set([
        ...dutyVehicleIds,
        ...standing.map((row) => String(row.vehicleId)),
        ...designated,
      ]),
    ];
    const inWorkshop = [...(await fleetVehiclesInWorkshop(candidates, day))];
    const codes = await fleetVehicleRepository.codesByIds(inWorkshop);
    return inWorkshop
      .map((vehicleId) => ({ vehicleId, vehicleCode: codes.get(vehicleId) ?? vehicleId }))
      .sort((a, b) => a.vehicleCode.localeCompare(b.vehicleCode, 'ar', { numeric: true }));
  }

  async plan(input: PlanOperationsCrew, by: string): Promise<{ changedCount: number }> {
    const day = utcDay(input.date);
    const removals = input.removeCrewAssignmentIds ?? [];

    // §9.4 anchor — every planned VAN must hold a Fleet duty row for the date (the legacy
    // car_lock gate, normalized). Resolved OUTSIDE the transaction: Fleet owns these rows. A row
    // without a van has nothing to anchor, by definition.
    const dutyRows = await fleetDutyAssignmentRepository.findForDate(day);
    const dutyByVehicle = new Map(dutyRows.map((row) => [String(row.vehicleId), row]));
    for (const row of input.rows) {
      if (row.vehicleId !== null && !dutyByVehicle.has(row.vehicleId)) {
        throw new BusinessRuleError(
          `vehicle ${row.vehicleId} is not on the Fleet roster for this date`,
          'OPERATIONS_FLEET_DUTY_REQUIRED',
        );
      }
    }

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

      // A ROW WITHOUT A VAN is addressed by its own id — for an edit and for a removal alike — and
      // the id must be a live row of THIS day with no van: a van's row is upserted by its van and
      // emptied, never removed (the van is Fleet's roster for the day, not this board's to drop).
      const vehiclelessRow = (id: string, field: string): OperationsCrewAssignmentDoc => {
        const row = byId.get(id);
        if (row === undefined) {
          throw new NotFoundError(`crew row ${id} is not a live row of this day`);
        }
        if (hasVan(row)) {
          throw new BusinessRuleError(
            `crew row ${id} is a van's row — it is addressed by its vehicle and emptied, never removed (${field})`,
          );
        }
        return row;
      };
      const removed = removals.map((id) => vehiclelessRow(id, 'removeCrewAssignmentIds'));
      // The saved row each payload row lands on; undefined for a new one.
      const currentOf = input.rows.map((row) =>
        row.vehicleId !== null
          ? byVehicle.get(row.vehicleId)
          : row.crewAssignmentId === undefined
            ? undefined
            : vehiclelessRow(row.crewAssignmentId, 'crewAssignmentId'),
      );

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
        const current = currentOf[index];
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
        const current = currentOf[index];
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

      // «الاتجاه» — read the areas only when some row brings a new direction (most saves move
      // people and touch no direction at all).
      let areaNames: string[] | null = null;
      const directionOf = async (
        row: PlanOperationsCrewRow,
        current: OperationsCrewAssignmentDoc | undefined,
        index: number,
      ): Promise<string | null> => {
        const direction = row.direction ?? null;
        if (direction === null) return null;
        // Unchanged — kept exactly as written, an old free-text direction included.
        if (direction === current?.direction || carriedDirections.has(direction)) return direction;
        areaNames ??= await operationsAreaRepository.activeNames();
        const canonical = canonicalOperationsDirection(direction, areaNames);
        if ('direction' in canonical) return canonical.direction;
        throw new AppError(
          ErrorCodes.OPERATIONS_DIRECTION_NOT_AN_AREA,
          422,
          `the direction names what is not an active area: ${canonical.unknown.join('، ')}`,
          {
            details: [
              ...canonical.unknown.map((part) => ({
                field: 'direction',
                code: 'NOT_AN_AREA',
                message: part,
              })),
              rowIndexDetail(index),
            ],
          },
        );
      };

      const changed: ChangedRow[] = [];
      const audits: PendingAudit[] = [];

      // REMOVALS FIRST — a row without a van, deleted (soft: the audit trail and any reader by id
      // keep it). Its people are free for the rows below; the event reports its slots emptied.
      for (const row of removed) {
        await operationsCrewAssignmentRepository.softDeleteById(String(row._id), { by, session });
        audits.push({
          entityId: String(row._id),
          action: 'delete',
          changes: diffChanges(snapshot(row), {}),
        });
        changed.push({
          crewAssignmentId: String(row._id),
          vehicleId: null,
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
          direction: await directionOf(row, current, index),
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
          // van with no row and for a row without a van added and left blank alike.
          const blank =
            !assigns(row) &&
            next.direction === null &&
            next.plannedTime === null &&
            next.notes === null &&
            next.shiftTypeId === null &&
            next.rowColour === null;
          if (blank) continue;
          let anchor: { vehicleId: Types.ObjectId | null; fleetDutyAssignmentId: Types.ObjectId | null } = {
            vehicleId: null,
            fleetDutyAssignmentId: null,
          };
          if (row.vehicleId !== null) {
            const duty = dutyByVehicle.get(row.vehicleId);
            if (duty === undefined) continue; // unreachable: checked before the transaction
            anchor = { vehicleId: new Types.ObjectId(row.vehicleId), fleetDutyAssignmentId: duty._id };
          }
          doc = await operationsCrewAssignmentRepository.create(
            { operationsDayId: dayDoc._id, ...anchor, ...set },
            { by, session },
          );
          audits.push({
            entityId: String(doc._id),
            action: 'create',
            changes: diffChanges({}, snapshot(doc)),
          });
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
          vehicleId: row.vehicleId,
          captainEmployeeIds: next.captainEmployeeIds,
          specialist1EmployeeIds: next.specialist1EmployeeIds,
          specialist2EmployeeIds: next.specialist2EmployeeIds,
        });
      }
      return { changed, audits };
    });

    // Audit + events only after the transaction has committed (roster.service.ts:272).
    for (const audit of outcome.audits) {
      await auditService.record({
        entityRef: entityRef(audit.entityId),
        action: audit.action,
        changes: audit.changes,
      });
    }
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
