// Odometer recording and correction (fleet design §4.3, FR-2; owner FL-4 points 1/3/6).
//
// CONTINUITY IS THE MODEL. A recording is one physical reading doing two jobs — closing the open
// period and opening the next — inside ONE transaction, so no crash can leave half a chain. A
// correction is the only other write, and because the closing reading of entry k IS the opening
// reading of entry k+1, correcting a shared reading adjusts BOTH rows in the same transaction;
// anything else would "fix" one row by silently breaking its neighbor. Events fire only after
// the transaction has committed.
import {
  FleetEvents,
  type CorrectFleetOdometer,
  type ListFleetOdometerQuery,
  type Paginated,
  type RecordFleetOdometer,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { isVehicleWritable } from '../vehicles/vehicle-status';
import { fleetOdometerRepository } from './odometer.repository';
import { type FleetOdometerLogDoc } from './odometer.model';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'odometerLog', entityId: id });

const invalid = (field: string, message: string): ValidationError =>
  new ValidationError([{ field: `body.${field}`, code: 'INVALID', message }]);

interface RecordOutcome {
  created: FleetOdometerLogDoc;
  closed: FleetOdometerLogDoc | null;
  code: string;
}

class FleetOdometerService {
  /** §4.3 — one reading closes the open period and opens the next, atomically. */
  async record(input: RecordFleetOdometer, by: string): Promise<FleetOdometerLogDoc> {
    const vehicle = await fleetVehicleRepository.getById(input.vehicleId);
    if (!isVehicleWritable(vehicle.status)) {
      throw new ConflictError('a disposed vehicle records no readings');
    }

    const outcome = await unitOfWork(async (session): Promise<RecordOutcome> => {
      const latest = await fleetOdometerRepository.findLatest(input.vehicleId, session);
      const floor =
        latest === null ? 0 : Math.max(latest.outReading, latest.inReading ?? latest.outReading);
      // FR-2 — the odometer never runs backwards. The ONLY way past this is the correction flow.
      if (latest !== null && input.reading < floor) {
        throw new ConflictError(
          `reading ${input.reading} is below the vehicle's latest reading ${floor} (FR-2); use the correction flow for a mis-entered past reading`,
        );
      }

      let closed: FleetOdometerLogDoc | null = null;
      if (latest !== null && latest.inReading === null) {
        closed = await fleetOdometerRepository.updateById(
          String(latest._id),
          { inReading: input.reading, km: input.reading - latest.outReading },
          { by, version: latest.__v, session },
        );
      }
      const created = await fleetOdometerRepository.create(
        {
          vehicleId: new Types.ObjectId(input.vehicleId),
          date: input.date,
          outReading: input.reading,
          inReading: null,
          km: null,
          driver1EmployeeId:
            input.driver1EmployeeId == null ? null : new Types.ObjectId(input.driver1EmployeeId),
          driver2EmployeeId:
            input.driver2EmployeeId == null ? null : new Types.ObjectId(input.driver2EmployeeId),
          notes: input.notes ?? null,
        },
        { by, session },
      );
      return { created, closed, code: vehicle.code };
    });

    await auditService.record({
      entityRef: entityRef(String(outcome.created._id)),
      action: 'create',
      changes: [
        { field: 'outReading', old: null, new: outcome.created.outReading },
        ...(outcome.closed === null
          ? []
          : [{ field: 'closedPeriodKm', old: null, new: outcome.closed.km }]),
      ],
    });
    await emit(FleetEvents.OdometerRecorded, {
      vehicleId: input.vehicleId,
      code: outcome.code,
      logId: String(outcome.created._id),
      outReading: outcome.created.outReading,
      closedKm: outcome.closed?.km ?? null,
    });
    return outcome.created;
  }

  /** H2's fate — the server, not the client, says what reading is expected next. */
  async expectedReading(vehicleId: string): Promise<number | null> {
    const latest = await fleetOdometerRepository.findLatest(vehicleId);
    if (latest === null) return null;
    return Math.max(latest.outReading, latest.inReading ?? latest.outReading);
  }

  async list(query: ListFleetOdometerQuery): Promise<Paginated<FleetOdometerLogDoc>> {
    return fleetOdometerRepository.listLogs({
      filter: fleetOdometerRepository.logFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  /**
   * The correction flow (owner FL-4 point 1) — `fleetOdometer.correct` only, fully audited.
   * A shared reading is ONE physical fact stored on two rows, so:
   *   - correcting `outReading` also rewrites the previous entry's `inReading` (+ its km);
   *   - correcting `inReading` (a closed entry) also rewrites the next entry's `outReading`;
   * and the corrected values must keep the whole chain ordered, or the correction is refused.
   */
  async correct(id: string, input: CorrectFleetOdometer, by: string): Promise<FleetOdometerLogDoc> {
    const changedFields: { field: string; old: string | null; new: string | null }[] = [];

    const { updated, vehicleId } = await unitOfWork(async (session) => {
      const entry = await fleetOdometerRepository.getById(id);
      const { prev, next } = await fleetOdometerRepository.findNeighbors(entry, session);

      const newOut = input.outReading ?? entry.outReading;
      const newIn = input.inReading === undefined ? entry.inReading : input.inReading;

      if (newIn !== null && newIn < newOut) {
        throw invalid('inReading', 'a period cannot end below its own start');
      }
      if (prev !== null && newOut <= prev.outReading) {
        throw invalid('outReading', 'the corrected reading falls below the previous period');
      }
      if (next !== null && newIn === null) {
        // The closing reading is shared with the next entry's opening — a middle period cannot
        // be "reopened"; the correction rewrites both rows, it never deletes the shared fact.
        throw invalid('inReading', 'a closed period between two others cannot be reopened');
      }
      if (
        next !== null &&
        newIn !== null &&
        newIn >= (next.inReading ?? Number.POSITIVE_INFINITY)
      ) {
        throw invalid('inReading', 'the corrected reading overlaps the next period');
      }

      const set: Partial<FleetOdometerLogDoc> = {
        outReading: newOut,
        inReading: newIn,
        km: newIn === null ? null : newIn - newOut,
      };
      if (input.date !== undefined) set.date = input.date;
      if (input.driver1EmployeeId !== undefined) {
        set.driver1EmployeeId =
          input.driver1EmployeeId == null ? null : new Types.ObjectId(input.driver1EmployeeId);
      }
      if (input.driver2EmployeeId !== undefined) {
        set.driver2EmployeeId =
          input.driver2EmployeeId == null ? null : new Types.ObjectId(input.driver2EmployeeId);
      }
      if (input.notes !== undefined) set.notes = input.notes ?? null;

      if (newOut !== entry.outReading) {
        changedFields.push({
          field: 'outReading',
          old: String(entry.outReading),
          new: String(newOut),
        });
      }
      if (newIn !== entry.inReading) {
        changedFields.push({
          field: 'inReading',
          old: entry.inReading === null ? null : String(entry.inReading),
          new: newIn === null ? null : String(newIn),
        });
      }

      const updatedEntry = await fleetOdometerRepository.updateById(id, set, {
        by,
        version: input.version,
        session,
      });

      // Propagate the SHARED readings — the identity that makes the chain a chain.
      if (prev !== null && newOut !== entry.outReading) {
        await fleetOdometerRepository.updateById(
          String(prev._id),
          { inReading: newOut, km: newOut - prev.outReading },
          { by, version: prev.__v, session },
        );
      }
      if (next !== null && newIn !== null && newIn !== entry.inReading) {
        await fleetOdometerRepository.updateById(
          String(next._id),
          {
            outReading: newIn,
            km: next.inReading === null ? null : next.inReading - newIn,
          },
          { by, version: next.__v, session },
        );
      }
      return { updated: updatedEntry, vehicleId: String(entry.vehicleId) };
    });

    await auditService.record({
      entityRef: entityRef(id),
      action: 'correct',
      changes:
        changedFields.length > 0
          ? changedFields
          : [{ field: 'metadata', old: null, new: 'corrected' }],
    });
    for (const change of changedFields) {
      await emit(FleetEvents.OdometerCorrected, {
        vehicleId,
        logId: id,
        field: change.field,
        old: change.old,
        new: change.new,
      });
    }
    return updated;
  }
}

export const fleetOdometerService = new FleetOdometerService();
