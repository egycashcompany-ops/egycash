// The captain's mobile read model — a NEW ECMS capability with NO legacy counterpart.
//
// The legacy system had no captain-facing surface at all: a captain never logged in, never saw a
// route and never recorded anything (discovery — there is no such screen among the 86 routes).
// Everything through OP-5 was legacy parity; this is the first slice that adds something the
// business did not previously have, so nothing here is measured against legacy behaviour.
//
// A QUERY, NOT A PROJECTION. There is deliberately no mobile-owned collection: this composes the
// existing domain entities (assignment → shipment → crew → branch → bank) at read time. A stored
// read model would duplicate four owners' data and start drifting the moment any of them changed,
// and the volume does not justify it — one captain-day is a handful of stops, and the query is
// driven by the `ix_day_captain` index the assignment model already carries. If a future profile
// shows this is too slow, a materialized view is a separate, documented decision.
//
// PROGRESS IS DERIVED, NOT STORED. `completed` is the shipment's own terminal status, `current` is
// the first stop that is not completed, and everything after it is `locked`. This is the shape the
// execution slice needs in order to enforce "N+1 cannot start before N completes" — but the RULE
// itself is not here, and this service performs no mutation of any kind.
//
// IDENTITY IS EMPLOYEE-LEVEL — see the contracts' identity-model block and design §20-هـ. There is
// no mobile user, no captain account and no second identity model: the captain is an ordinary ECMS
// employee, and this surface is a capability inside that employee's authenticated profile. The
// chain is resolved strictly in this order, entirely server-side:
//
//   token → employee (platform directory seam)
//         → captain assignment for the operating day (the (day, vehicle) crew row)
//         → ordered shipments
//
// Note which step decides what. RBAC decides whether the employee may OPEN this surface;
// the crew row decides whether he is a CAPTAIN TODAY. Conflating those is how a permission
// silently becomes a job title, so they are answered separately and both are answered here.
import {
  type OperationsMobileDayDto,
  type OperationsMobileStopDto,
  type OperationsRouteStopLocationDto,
  type OperationsShipmentLeg,
  type OperationsStopProgress,
} from '@ecms/contracts';
import { type Types } from 'mongoose';
import { ForbiddenError } from '../../../shared/errors';
import { getSelfDirectoryEmployee, type DirectoryEmployee } from '../../../platform/directory';
import { operationsBankRepository } from '../banks/bank.repository';
import { operationsBankBranchRepository } from '../bank-branches/bank-branch.repository';
import { operationsCrewAssignmentRepository } from '../crew/crew-assignment.repository';
import { type OperationsCrewAssignmentDoc } from '../crew/crew-assignment.model';
import { operationsDayService, utcDay } from '../days/day.service';
import { operationsShipmentRepository } from '../shipments/shipment.repository';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { type OperationsShipmentAssignmentDoc } from '../shipments/shipment-assignment.model';

const LEGS: OperationsShipmentLeg[] = ['pickup', 'delivery'];

/**
 * Who is logged in, as an EMPLOYEE — resolved through the platform directory seam, never from the
 * request body or query.
 *
 * Deliberately named for the employee and not for the captain: this step establishes IDENTITY, and
 * identity is employee-level. Whether that employee is a captain today is a separate question with
 * a separate answer (the day's crew assignment), and collapsing the two here is precisely the
 * mistake the identity constraint forbids — it would turn a login into a job title.
 *
 * There is no captain parameter on any endpoint in this slice, so a client cannot ask for somebody
 * else's day; cross-captain isolation is a property of the API's shape, not a filter someone has
 * to remember to apply.
 */
export const resolveSelfEmployee = async (userId: string): Promise<DirectoryEmployee> => {
  const employee = await getSelfDirectoryEmployee(userId);
  if (employee === null) {
    throw new ForbiddenError('this login is not linked to an employee record');
  }
  if (employee.status === 'exited') {
    throw new ForbiddenError('this employee has exited');
  }
  return employee;
};

class OperationsMobileService {
  /** One captain's ordered day. Read-only, self-scoped, composed from the owning entities. */
  async myDay(userId: string, date: Date | undefined): Promise<OperationsMobileDayDto> {
    // Step 1 — IDENTITY. The employee behind the token; no client input participates.
    const captain = await resolveSelfEmployee(userId);
    const day = date === undefined ? utcDay(new Date()) : utcDay(date);
    const dayDoc = await operationsDayService.findByDate(day);

    const base = {
      date: day.toISOString(),
      captain: {
        employeeId: captain.employeeId,
        code: captain.code,
        fullNameAr: captain.fullNameAr,
      },
    };
    if (dayDoc === null) {
      return {
        ...base,
        operationsDayId: null,
        dayStatus: null,
        isCaptainOnDay: false,
        assignments: [],
        stops: [],
        currentAssignmentId: null,
      };
    }

    // Step 2 — CAPTAINCY. The (day, vehicle) crew rows this employee is the captain of. This is the
    // ANCHOR of the chain, asked directly rather than inferred from whichever shipments happen to
    // be assigned: an employee planned onto a vehicle IS a captain today even before dispatch has
    // given him a single stop, and the surface must be able to say so.
    const crewRows = await operationsCrewAssignmentRepository.findForCaptainDay(
      dayDoc._id,
      captain.employeeId,
    );

    // Step 3 — ORDERED SHIPMENTS. The captain's stops across BOTH legs, in the server-established
    // order, scoped by the SAME server-resolved employee. The client never sorts and never
    // reorders: `sequence` is authoritative and read-only here.
    const rows: OperationsShipmentAssignmentDoc[] = [];
    for (const leg of LEGS) {
      rows.push(
        ...(await operationsShipmentAssignmentRepository.findForCaptainDay(
          dayDoc._id,
          captain.employeeId,
          leg,
        )),
      );
    }
    rows.sort((a, b) => a.sequence - b.sequence || a.leg.localeCompare(b.leg));

    const branchCache = new Map<string, OperationsRouteStopLocationDto>();
    const place = async (branchId: Types.ObjectId): Promise<OperationsRouteStopLocationDto> => {
      const key = String(branchId);
      const hit = branchCache.get(key);
      if (hit !== undefined) return hit;
      const branch = await operationsBankBranchRepository.findById(key);
      const bank =
        branch === null ? null : await operationsBankRepository.findById(String(branch.bankId));
      const view: OperationsRouteStopLocationDto = {
        branchId: key,
        branchName: branch?.name ?? '',
        branchCode: branch?.code ?? '',
        bankName: bank?.opsName ?? '',
        areaName: branch?.opsAreaName ?? null,
        // The OP-2 location model, unchanged and OPTIONAL. Legacy carried no coordinates at all;
        // a branch without them yields `null` here and the client simply has no map to draw.
        location: branch?.location ?? null,
      };
      branchCache.set(key, view);
      return view;
    };

    const stops: OperationsMobileStopDto[] = [];
    let currentAssignmentId: string | null = null;
    for (const row of rows) {
      const shipment = await operationsShipmentRepository.findById(String(row.shipmentId));
      if (shipment === null) continue;

      const done = shipment.status === 'completed';
      let progress: OperationsStopProgress;
      if (done) {
        progress = 'completed';
      } else if (currentAssignmentId === null) {
        progress = 'current';
        currentAssignmentId = String(row._id);
      } else {
        progress = 'locked';
      }

      stops.push({
        assignmentId: String(row._id),
        shipmentId: String(row.shipmentId),
        operationsDayId: String(row.operationsDayId),
        sequence: row.sequence,
        leg: row.leg,
        vehicleId: String(row.vehicleId),
        crewAssignmentId: String(row.crewAssignmentId),
        shipmentType: shipment.shipmentType,
        status: shipment.status,
        progress,
        referenceNumber: shipment.receiptNumber,
        packaging: null, // packaging lives on the custody record; the mobile slice does not need it
        pickup: await place(shipment.originBranchId),
        delivery: await place(shipment.destinationBranchId),
      });
    }

    // The captain assignments themselves — specialists are read from the (day, vehicle) crew row
    // and are NEVER present on a stop. That indirection is the legacy relationship, kept intact.
    //
    // The anchor rows come first, so a captain planned onto a vehicle appears here even with no
    // stops. Any crew row a stop points at is then unioned in: a stop the client is asked to render
    // must always have its crew resolvable, even in the drifted case where the day's plan was later
    // re-captained out from under an already-assigned shipment.
    const assignments: OperationsMobileDayDto['assignments'] = [];
    const seen = new Set<string>();
    const describe = (crew: OperationsCrewAssignmentDoc): void => {
      const crewAssignmentId = String(crew._id);
      if (seen.has(crewAssignmentId)) return;
      seen.add(crewAssignmentId);
      assignments.push({
        crewAssignmentId,
        vehicleId: String(crew.vehicleId),
        specialist1EmployeeId:
          crew.specialist1EmployeeId === null ? null : String(crew.specialist1EmployeeId),
        specialist2EmployeeId:
          crew.specialist2EmployeeId === null ? null : String(crew.specialist2EmployeeId),
        direction: crew.direction,
        plannedTime: crew.plannedTime,
      });
    };
    for (const crew of crewRows) describe(crew);
    for (const crewAssignmentId of new Set(stops.map((s) => s.crewAssignmentId))) {
      if (seen.has(crewAssignmentId)) continue;
      const crew = await operationsCrewAssignmentRepository.findById(crewAssignmentId);
      if (crew !== null) describe(crew);
    }

    return {
      ...base,
      operationsDayId: String(dayDoc._id),
      dayStatus: dayDoc.status,
      // Captaincy is the day's plan, not the login and not the permission.
      isCaptainOnDay: crewRows.length > 0,
      assignments,
      stops,
      currentAssignmentId,
    };
  }
}

export const operationsMobileService = new OperationsMobileService();
