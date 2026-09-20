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
  parseFleetSort,
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
import { computeAlarms } from '../maintenance/maintenance-alarm';
import { alarmSortsFor } from '../maintenance/alarm-sort';
import { fleetOdometerRepository } from './odometer.repository';
import { vehicleIdOf, vehicleIdsOf } from '../fleet.mappers';
import { type FleetOdometerLogDoc } from './odometer.model';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'odometerLog', entityId: id });

const invalid = (field: string, message: string): ValidationError =>
  new ValidationError([{ field: `body.${field}`, code: 'INVALID', message }]);

/** The day a bound was taken on, for a refusal that has to name WHICH reading it is refusing. */
const iso = (date: Date): string => date.toISOString().slice(0, 10);

interface RecordOutcome {
  created: FleetOdometerLogDoc;
  /** The row this reading closed (an append) or split in two (a back-dated insert). */
  closed: FleetOdometerLogDoc | null;
  /** true = the reading landed INSIDE the chain rather than extending it. */
  inserted: boolean;
  code: string;
}

/**
 * A log and the registry's code for its vehicle. Every screen that shows a reading shows the code
 * beside it, and the client cannot resolve one for a car outside the page of the registry it
 * happens to hold — so the code travels with the row, as it already does on the roster board.
 */
export interface OdometerLogWithCode {
  doc: FleetOdometerLogDoc;
  vehicleCode: string | null;
}

/** The FR-2 floor, and the date of the reading it came from. Both from one document. */
export interface ExpectedReading {
  reading: number | null;
  asOf: Date | null;
}

/** Both ends of the bracket for one vehicle on one date, dates included. */
export interface OdometerBracket {
  lowerBound: number | null;
  lowerBoundAt: Date | null;
  upperBound: number | null;
  upperBoundAt: Date | null;
}

/** A page of logs plus the codes for exactly the vehicles ON that page — one lookup, not one per row. */
export type OdometerLogPage = Paginated<FleetOdometerLogDoc> & {
  codes: ReadonlyMap<string, string>;
};

class FleetOdometerService {
  /** §4.3 — one reading closes the open period and opens the next, atomically. */
  async record(input: RecordFleetOdometer, by: string): Promise<OdometerLogWithCode> {
    const vehicle = await fleetVehicleRepository.getById(input.vehicleId);
    if (!isVehicleWritable(vehicle.status)) {
      throw new ConflictError('a disposed vehicle records no readings');
    }

    const outcome = await unitOfWork(async (session): Promise<RecordOutcome> => {
      /*
       * FR-2, ASKED OF THE READING'S OWN DATE RATHER THAN OF THE END OF THE CHAIN.
       *
       * «لو مدخلتش يوم وضيف اليوم اللى بعده … يشوف قراءه السبت تكون اقل من الاحد واكتر من الخميس».
       *
       * The rule used to be "not below the vehicle's latest reading", which is the same question
       * only while readings arrive in order. A day that was missed cannot arrive in order: enter
       * Sunday, then go back for Saturday, and Saturday is legitimately BELOW Sunday — the old
       * rule refused the only reading that could be correct, and sent the clerk to the correction
       * flow to repair a chain that was never wrong.
       *
       * So the floor and the ceiling are both read off the DATE: the highest reading standing on
       * or before that day, and the lowest taken after it. An odometer that never runs backwards
       * is exactly a reading that sits between its own two neighbours in time. Either bound may be
       * absent — the first reading a vehicle ever has no floor, the newest has no ceiling — and an
       * absent bound constrains nothing.
       *
       * Equal to a bound is ACCEPTED at both ends, as the old floor accepted equality: a car that
       * did not move between two readings is an ordinary fact, and a zero-km period is how the log
       * says so. The dialog warns about it; nothing refuses it.
       */
      const bounds = await fleetOdometerRepository.chainBounds(
        input.vehicleId,
        input.date,
        session,
      );

      /*
       * A DAY WITH NO READING — «لا اما يسيبو فاضى ويدله انذار ان العربيه دى المفروض تدخل الرقم
       * عشان احسب الصيانه».
       *
       * A day that was missed can still be worth recording: who took the car out, and what
       * happened. What it cannot carry is a counter nobody wrote down, and every number this
       * could invent for it would be a lie told in the one column the maintenance alarm measures
       * from. So the reading may be left out — and ONLY where leaving it out changes nothing that
       * is measured: a day the chain already brackets on BOTH sides. Thursday was read, Sunday
       * was read, and Saturday sits between them; Thursday's row already carries the whole
       * Thursday-to-Sunday distance, and the Saturday row adds no distance because none was
       * measured on it.
       *
       * Either bound absent and the reading is REQUIRED, which is the same sentence read twice:
       * no bound below means the vehicle has no reading before that day, so nothing brackets it;
       * no bound above means the day is at the END of the chain, and a day at the end with no
       * reading would be the car's open period carrying no number at all. «بس اللى هى فاتت».
       *
       * The row is on NO CHAIN. It closes nothing, opens nothing, hands nothing on, splices no
       * period, and `ON_THE_CHAIN` in the repository keeps it out of every question the chain is
       * asked. The alarm counts it instead — see `daysWithoutReading` — so the distance since the
       * last service is reported as what it is: measured, with days in it that nobody measured.
       */
      if (input.reading == null) {
        if (bounds.lower === null || bounds.upper === null) {
          throw new ConflictError(
            'a reading may be left out only for a day that already has a reading before it AND after it; this date is at the end of the chain, or the vehicle has no earlier reading',
          );
        }
        const already = await fleetOdometerRepository.findDayWithoutReading(
          input.vehicleId,
          input.date,
          session,
        );
        if (already !== null) {
          throw new ConflictError('this day is already recorded for this vehicle without a reading');
        }
        const day = await fleetOdometerRepository.create(
          {
            vehicleId: new Types.ObjectId(input.vehicleId),
            date: input.date,
            outReading: null,
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
        return { created: day, closed: null, inserted: false, code: vehicle.code };
      }

      if (bounds.lower !== null && input.reading < bounds.lower.reading) {
        throw new ConflictError(
          `reading ${input.reading} is below the ${bounds.lower.reading} already recorded on or before ${iso(bounds.lower.date)} (FR-2); use the correction flow for a mis-entered past reading`,
        );
      }
      if (bounds.upper !== null && input.reading > bounds.upper.reading) {
        throw new ConflictError(
          `reading ${input.reading} is above the ${bounds.upper.reading} recorded later, on ${iso(bounds.upper.date)} (FR-2); the odometer would have to run backwards after this date`,
        );
      }

      /*
       * WHERE IT GOES IN THE CHAIN — the row it follows, found by DATE. Three shapes, and they are
       * the only three:
       *   • prior is the OPEN row  → the reading extends the chain: close it, open the next.
       *   • prior is a closed row  → the reading lands INSIDE its period: split it in two.
       *   • there is no prior      → nothing is dated earlier: it becomes the chain's head.
       *
       * Whichever it is, the new row takes over exactly what the row before it was closing with,
       * so the model's one invariant — `inReading` of entry k IS `outReading` of entry k+1 — comes
       * out true by construction rather than by a second pass over the chain.
       */
      const prior = await fleetOdometerRepository.findPriorByDate(
        input.vehicleId,
        input.date,
        session,
      );
      const head =
        prior === null
          ? await fleetOdometerRepository.findChainHead(input.vehicleId, session)
          : null;

      let closed: FleetOdometerLogDoc | null = null;
      if (prior !== null) {
        closed = await fleetOdometerRepository.updateById(
          String(prior._id),
          // `findPriorByDate` answers with a row that is ON THE CHAIN, so its reading is a number.
          { inReading: input.reading, km: input.reading - (prior.outReading as number) },
          { by, version: prior.__v, session },
        );
      }
      // What the new row hands ON to the row after it. `null` only when it is taking over the open
      // period; otherwise it inherits whatever the row it displaced used to close with, so the
      // entry that followed still opens on a reading somebody is handing it.
      const handOn = prior === null ? (head?.outReading ?? null) : prior.inReading;
      const created = await fleetOdometerRepository.create(
        {
          vehicleId: new Types.ObjectId(input.vehicleId),
          date: input.date,
          outReading: input.reading,
          inReading: handOn,
          km: handOn === null ? null : handOn - input.reading,
          driver1EmployeeId:
            input.driver1EmployeeId == null ? null : new Types.ObjectId(input.driver1EmployeeId),
          driver2EmployeeId:
            input.driver2EmployeeId == null ? null : new Types.ObjectId(input.driver2EmployeeId),
          notes: input.notes ?? null,
        },
        { by, session },
      );
      return { created, closed, inserted: handOn !== null, code: vehicle.code };
    });

    await auditService.record({
      entityRef: entityRef(String(outcome.created._id)),
      action: 'create',
      changes: [
        // A day recorded with no counter did not record a reading of «null» — it recorded a day.
        // The trail says which of the two happened, because the two are not the same act.
        ...(outcome.created.outReading === null
          ? [{ field: 'dayWithoutReading', old: null, new: true }]
          : [{ field: 'outReading', old: null, new: outcome.created.outReading }]),
        // A back-dated reading SPLITS a period that was already closed, so the trail has to say
        // that rather than reading like an ordinary close: two rows now carry the km one row used
        // to, and the audit is where that is explained if the figures are ever questioned.
        ...(outcome.inserted ? [{ field: 'insertedIntoChain', old: null, new: true }] : []),
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
    return { doc: outcome.created, vehicleCode: outcome.code };
  }

  /**
   * H2's fate — the server, not the client, says what reading is expected next.
   *
   * `asOf` is the date OF THAT SAME DOCUMENT, read from the row the floor was taken from rather
   * than looked up again: a second query could pick a different row and date a floor it did not
   * produce.
   *
   * This is the END of the chain, which is the right answer for the ordinary case — a reading
   * taken today — and only for that case. A reading being entered for a day that was MISSED is
   * bracketed by its own two neighbours instead (see `record`), and the dialog asks `bracket` for
   * those. Nothing here is a rule: `expectedReading` is a hint, and `record` is the authority.
   */
  async expectedReading(vehicleId: string): Promise<ExpectedReading> {
    const latest = await fleetOdometerRepository.findLatest(vehicleId);
    if (latest === null) return { reading: null, asOf: null };
    return {
      // `findLatest` answers with a row that is ON THE CHAIN — a day with no reading is not one.
      reading: Math.max(latest.outReading as number, latest.inReading ?? (latest.outReading as number)),
      asOf: latest.date,
    };
  }

  /**
   * Where a counter measured on `on` would have to sit to be a point on this vehicle's chain.
   *
   * The bracket is a property of a DATE as well as a vehicle, which is what makes a back-dated
   * visit legitimate rather than suspicious: the same car answers differently for a visit closed
   * last month than for one closed today, and the counter that belonged to last month is only
   * "below the chain" if the chain had already passed it BY THEN.
   *
   * Answers a bracket for a vehicle with no readings at all — both sides null, which the rule
   * reads as "nothing to compare against" rather than as a violation.
   */
  async bracket(vehicleId: string, on: Date): Promise<OdometerBracket> {
    const { lower, upper } = await fleetOdometerRepository.chainBounds(vehicleId, on);
    return {
      lowerBound: lower?.reading ?? null,
      lowerBoundAt: lower?.date ?? null,
      upperBound: upper?.reading ?? null,
      upperBoundAt: upper?.date ?? null,
    };
  }

  /**
   * The filtered page.
   *
   * Two of the filters name something the odometer collection does not store, so they are
   * RESOLVED to vehicle ids here — where the vehicle registry and the alarm projection are
   * reachable — and the repository stays a query over its own documents:
   *
   *   • `vehicleCodes` — the code is what the registry calls a car and what a shared link should
   *     read as; a code that matches nothing narrows to nothing.
   *   • `alerts` — the maintenance level is DERIVED per vehicle (FR-3) from settings the admin
   *     owns, so it is computed and then used to pick vehicles, never stored on a reading.
   *
   * When both are given the answer is their INTERSECTION, and an empty intersection returns an
   * empty page. Dropping the filter there would answer a narrowed question with every reading in
   * the system, which reads as "no matches were excluded" and is the one wrong answer available.
   */
  async list(query: ListFleetOdometerQuery): Promise<OdometerLogPage> {
    let vehicleIds: string[] | undefined;

    if (query.vehicleCodes !== undefined) {
      const matched = await fleetVehicleRepository.list({
        filter: { code: { $in: [...query.vehicleCodes] } },
        page: 1,
        pageSize: query.vehicleCodes.length,
      });
      vehicleIds = matched.items.map((vehicle) => String(vehicle._id));
    }

    if (query.alerts !== undefined) {
      const wanted = new Set<string>(query.alerts);
      const alarms = await computeAlarms();
      const byLevel = alarms.filter((a) => wanted.has(a.level)).map((a) => a.vehicleId);
      vehicleIds =
        vehicleIds === undefined ? byLevel : vehicleIds.filter((id) => byLevel.includes(id));
    }

    const sorts = parseFleetSort(query.sort);
    const page = await fleetOdometerRepository.listLogs({
      filter: fleetOdometerRepository.logFilter({
        ...query,
        vehicleIds,
        // The typed codes may stand on their own only when nothing else narrowed the ids: a
        // reading kept from the old book on a car the registry never had has no alarm level.
        vehicleCodes: query.alerts === undefined ? query.vehicleCodes : undefined,
      }),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      // …and the rest of the reader's order behind it. `sortBy` stays the first column
      // so nothing that only speaks the pagination contract is left sorting by nothing.
      sorts,
      // «فارق عداد الصيانة» is a figure about the CAR, not about the reading — so it is computed
      // for the fleet and handed to the query as something it can order by. Only when the reader
      // has actually asked for it: on every other request this is an empty list and the register
      // stays the plain, indexed query it was.
      sortDerived: await alarmSortsFor([...sorts, { by: query.sortBy ?? '' }]),
    });
    // The codes for the vehicles ON this page, in one query — bounded by the page, never by how
    // many vehicles the registry holds.
    const codes = await fleetVehicleRepository.codesByIds(vehicleIdsOf(page.items));
    return { ...page, codes };
  }

  /**
   * The correction flow (owner FL-4 point 1) — `fleetOdometer.correct` only, fully audited.
   * A shared reading is ONE physical fact stored on two rows, so:
   *   - correcting `outReading` also rewrites the previous entry's `inReading` (+ its km);
   *   - correcting `inReading` (a closed entry) also rewrites the next entry's `outReading`;
   * and the corrected values must keep the whole chain ordered, or the correction is refused.
   */
  async correct(id: string, input: CorrectFleetOdometer, by: string): Promise<OdometerLogWithCode> {
    const changedFields: { field: string; old: string | null; new: string | null }[] = [];

    const { updated, vehicleId, bookCode } = await unitOfWork(async (session) => {
      const entry = await fleetOdometerRepository.getById(id);

      /*
       * A DAY RECORDED WITH NO READING IS NOT CORRECTED HERE. It is on no chain — there are no
       * neighbours to check it against and no period to rewrite — so the two reading fields have
       * nothing to mean on it. The way to give that day a counter is to RECORD the reading for
       * that date, which splices into the chain properly; everything else about the day (who
       * drove, the note) is corrected exactly as on any other row.
       */
      if (entry.outReading === null && (input.outReading !== undefined || input.inReading !== undefined)) {
        throw invalid(
          'outReading',
          'this day was recorded without a reading — record the reading for that date instead of correcting this row',
        );
      }
      const { prev, next } =
        entry.outReading === null
          ? { prev: null, next: null }
          : await fleetOdometerRepository.findNeighbors(entry, session);

      const newOut = input.outReading ?? entry.outReading;
      const newIn = input.inReading === undefined ? entry.inReading : input.inReading;

      if (newOut !== null && newIn !== null && newIn < newOut) {
        throw invalid('inReading', 'a period cannot end below its own start');
      }
      if (prev !== null && newOut !== null && newOut <= (prev.outReading as number)) {
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
        km: newIn === null || newOut === null ? null : newIn - newOut,
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
      // `prev` is non-null only for a row that is itself on the chain, so both readings are
      // numbers here — a day with no reading has no neighbours at all.
      if (prev !== null && newOut !== null && newOut !== entry.outReading) {
        await fleetOdometerRepository.updateById(
          String(prev._id),
          { inReading: newOut, km: newOut - (prev.outReading as number) },
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
      return { updated: updatedEntry, vehicleId: vehicleIdOf(entry), bookCode: entry.vehicleCode };
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
    // A reading kept from the old book for a car the registry never had names its car itself.
    if (vehicleId === null) return { doc: updated, vehicleCode: bookCode };
    return {
      doc: updated,
      vehicleCode: (await fleetVehicleRepository.codesByIds([vehicleId])).get(vehicleId) ?? null,
    };
  }
}

export const fleetOdometerService = new FleetOdometerService();
