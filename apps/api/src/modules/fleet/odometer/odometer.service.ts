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
  addDaysYmd,
  compareFleetVehicleCodes,
  parseFleetSort,
  ymdOf,
  ymdToUtcDate,
  type CorrectFleetOdometer,
  type FleetDashboardPeriodKmDto,
  type FleetOdometerSummaryDto,
  type FleetOdometerSummaryQuery,
  type FleetVehicleLatestReadingDto,
  type ListFleetOdometerQuery,
  type LocalizedString,
  type Paginated,
  type RecordFleetOdometer,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { branchRepository } from '../../../platform/organization/branches/branch.repository';
import {
  fleetVehicleRepository,
  intersectVehicleIds,
  vehicleSetPart,
} from '../vehicles/vehicle.repository';
import { resolveVehicleFilterIds } from '../vehicles/vehicle-set';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { isVehicleWritable } from '../vehicles/vehicle-status';
import { computeAlarms } from '../maintenance/maintenance-alarm';
import {
  alarmSortsFor,
  sharedAlarmProjection,
  type AlarmProjection,
} from '../maintenance/alarm-sort';
import { fleetMaintenanceRepository } from '../maintenance/maintenance.repository';
import { fleetOdometerRepository } from './odometer.repository';
import { vehicleIdOf, vehicleIdsOf } from '../fleet.mappers';
import { type FleetOdometerLogDoc } from './odometer.model';
import { planCorrection } from './correction-rules';
import { loadServiceGaps } from './service-gap';
import { kmBreakdownOf, missingReadingCutoff, type KmVehicle } from './km-rules';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'odometerLog', entityId: id });

const invalid = (field: string, message: string): ValidationError =>
  new ValidationError([{ field: `body.${field}`, code: 'INVALID', message }]);

/** The day a bound was taken on, for a refusal that has to name WHICH reading it is refusing. */
const iso = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Midnight UTC of today — the line between «a day that has passed» and «now».
 *
 * A reading's date arrives as `<input type="date">` → midnight UTC, so a date strictly below this
 * is yesterday or earlier however the clock is read. The whole rule about leaving a reading out
 * turns on it: «بس اللى هى فاتت».
 */
const startOfTodayUtc = (): Date => {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return start;
};

interface RecordOutcome {
  created: FleetOdometerLogDoc;
  /** The row this reading closed (an append) or split in two (a back-dated insert). */
  closed: FleetOdometerLogDoc | null;
  /** true = the reading landed INSIDE the chain rather than extending it. */
  inserted: boolean;
  /** true = it filled a day already on record without a counter, rather than adding a row. */
  filled: boolean;
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
  /** «فارق عداد الصيانة» at this row — see `service-gap.ts`. */
  serviceGapKm: number | null;
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

/**
 * A page of logs plus the codes for exactly the vehicles ON that page — one lookup, not one per
 * row — and each row's «فارق عداد الصيانة» (D1), keyed by row id, computed for the page.
 */
export type OdometerLogPage = Paginated<FleetOdometerLogDoc> & {
  codes: ReadonlyMap<string, string>;
  gaps: ReadonlyMap<string, number | null>;
};

/** The gap of the one row a write answers with. */
const gapOf = async (doc: FleetOdometerLogDoc): Promise<number | null> =>
  (await loadServiceGaps([doc])).get(String(doc._id)) ?? null;

/**
 * The kilometres of a period (tabs 6–8): the register's VEHICLE filters — what a dashboard link
 * carries to `/fleet/odometer` — and the two Cairo days. The driver, note and alarm filters are not
 * offered: a row's successor decides whether it is single-day, and a filter that dropped the
 * successor (another driver's shift) would turn every day into a span.
 */
export type OdometerKmQuery = Pick<
  FleetOdometerSummaryQuery,
  'vehicleId' | 'vehicleCodes' | 'typeIds' | 'operationIds' | 'branchIds'
> & { from: string; to: string };

export interface OdometerKmContext {
  /** The Cairo day of the request's clock. */
  today: string;
  /** N = `fleet.odometer.missingReadingDays`: the grace before an open row turns stale (R-15). */
  staleDays: number;
  /** The switcher's branch (`activeBranchId`): the km by type is drawn only when one is chosen. */
  branchId: string | null;
  /** A vehicle set narrows the period (R-13): rows without a car are then not reported apart. */
  setNarrows: boolean;
}

/** R-07: the cars that fire «بلا قراءة عداد منذ N أيام», and the ones never read at all. */
export interface OdometerNoReadingDigest {
  /** Latest chain date before today − days; code order. */
  stale: { vehicleId: string; code: string; lastDate: string }[];
  /** No chain reading ever; code order. */
  neverRead: { vehicleId: string; code: string }[];
}

/** The vehicle half of a register filter, resolved: the ids, and the typed codes that may stand alone. */
interface OdometerVehicleClause {
  vehicleIds: string[] | undefined;
  vehicleCodes: readonly string[] | undefined;
}

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
       * from. So the reading may be left out — «بس اللى هى فاتت», and that is the whole rule: the
       * day must be BEHIND us. Today's reading is the one somebody is standing at the car to
       * take, and tomorrow's has not happened.
       *
       * IT USED TO ASK FOR MORE — a reading before the day AND after it — on the reasoning that a
       * day at the end of the chain with no reading would be the car's open period carrying no
       * number. That reasoning was already obsolete when it was written: the row is on NO CHAIN,
       * so it cannot BE the open period, and `ux_open_period` excludes it by name. What is left is
       * the owner's own sentence, and nothing else was ever doing any work.
       *
       * The row closes nothing, opens nothing, hands nothing on, splices no period, and
       * `ON_THE_CHAIN` in the repository keeps it out of every question the chain is asked. The
       * alarm counts it instead — see `daysWithoutReading` — so the distance since the last
       * service is reported as what it is: measured, with days in it that nobody measured.
       */
      if (input.reading == null) {
        if (input.date >= startOfTodayUtc()) {
          throw new ConflictError(
            'a reading may be left out only for a day that has already passed; today’s reading is the one somebody is at the car to take',
          );
        }
        const already = await fleetOdometerRepository.findDayWithoutReading(
          input.vehicleId,
          input.date,
          session,
        );
        if (already !== null) {
          throw new ConflictError(
            'this day is already recorded for this vehicle without a reading',
          );
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
        return { created: day, closed: null, inserted: false, filled: false, code: vehicle.code };
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
      const measured = {
        outReading: input.reading,
        inReading: handOn,
        km: handOn === null ? null : handOn - input.reading,
      };

      /*
       * THE DAY MAY ALREADY BE ON RECORD WITHOUT ITS COUNTER — and then this is that counter, not
       * a second day.
       *
       * The clerk logs Saturday with no reading because nobody wrote one down; on Tuesday the
       * number turns up in the driver's own notebook and is entered for Saturday. Written as a new
       * row it would leave the register showing ONE Saturday TWICE — once with the reading and
       * once still saying «بدون قراءة» about a day that now has one. So the reading fills the row
       * that is already there.
       *
       * WHAT THE SECOND FORM LEAVES BLANK IS NOT A RETRACTION. The empty day may be the only
       * surviving record of who took the car out, and the person entering a number found in a
       * notebook days later is not being asked to remember the drivers again. So the new
       * submission wins wherever it says something, and where it says nothing the day keeps what
       * it was recorded with.
       */
      const empty = await fleetOdometerRepository.findDayWithoutReading(
        input.vehicleId,
        input.date,
        session,
      );
      const driver = (
        given: string | null | undefined,
        had: Types.ObjectId | null,
      ): Types.ObjectId | null => (given == null ? had : new Types.ObjectId(given));
      const created =
        empty === null
          ? await fleetOdometerRepository.create(
              {
                vehicleId: new Types.ObjectId(input.vehicleId),
                date: input.date,
                ...measured,
                driver1EmployeeId: driver(input.driver1EmployeeId, null),
                driver2EmployeeId: driver(input.driver2EmployeeId, null),
                notes: input.notes ?? null,
              },
              { by, session },
            )
          : await fleetOdometerRepository.updateById(
              String(empty._id),
              {
                date: input.date,
                ...measured,
                driver1EmployeeId: driver(input.driver1EmployeeId, empty.driver1EmployeeId),
                driver2EmployeeId: driver(input.driver2EmployeeId, empty.driver2EmployeeId),
                notes: input.notes ?? empty.notes,
              },
              { by, version: empty.__v, session },
            );
      return {
        created,
        closed,
        inserted: handOn !== null,
        filled: empty !== null,
        code: vehicle.code,
      };
    });

    await auditService.record({
      entityRef: entityRef(String(outcome.created._id)),
      // Filling a day that was already on record is an UPDATE of that row, and the trail has to
      // say so — the row's id is older than this act, and «create» would date it wrongly.
      action: outcome.filled ? 'update' : 'create',
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
    return {
      doc: outcome.created,
      vehicleCode: outcome.code,
      serviceGapKm: await gapOf(outcome.created),
    };
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
    // The alarm's own read, so the hint and «فارق عداد الصيانة» name the same reading — and the
    // row the FR-2 floor is taken from: the highest OPENING reading, the later day first on a tie
    // (a parked day must not hide the next day's closing reading), reported as how far that row
    // got. An old row's closing reading — a book that did not chain, a typo — never answers here,
    // nor does a day with no reading, which is on no chain.
    const latest = (await fleetOdometerRepository.latestReadings([vehicleId])).get(vehicleId);
    if (latest === undefined) return { reading: null, asOf: null };
    return { reading: latest.reading, asOf: latest.date };
  }

  /**
   * «تمام وزود اخر عداد» — every registry car's last reading, for the car card's «آخر قراءة عداد».
   *
   * Every car not soft-deleted, ANY status: the alarm projection reads active cars only, and a car
   * set out of service after an accident still has its log. The reading is the alarm's own read
   * (`latestReadings`), so an active car's figure here IS its alarm row's. A car with no reading on
   * file has no row.
   */
  async latestReadingsOfFleet(): Promise<FleetVehicleLatestReadingDto[]> {
    const ids = (await fleetVehicleRepository.idsMatching({})).map(String);
    const latest = await fleetOdometerRepository.latestReadings(ids);
    return [...latest.values()].map((row) => ({
      vehicleId: row.vehicleId,
      latestReading: row.reading,
      latestReadingAt: row.date.toISOString(),
    }));
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
    const sorts = parseFleetSort(query.sort);
    // The «الإنذار» filter and the alarm column both read the whole-fleet projection. One request
    // computes it once at most — and only if one of them asks — and the two are resolved side by
    // side: neither needs the other's answer, and they used to run one after the other.
    const alarms = sharedAlarmProjection();
    const [filter, sortDerived] = await Promise.all([
      this.filterFor(query, alarms),
      // «فارق عداد الصيانة» is a figure about the CAR, not about the reading — so it is computed
      // for the fleet and handed to the query as something it can order by. Only when the reader
      // has actually asked for it: on every other request this is an empty list and the register
      // stays the plain, indexed query it was.
      alarmSortsFor([...sorts, { by: query.sortBy ?? '' }], alarms),
    ]);
    const page = await fleetOdometerRepository.listLogs({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      // …and the rest of the reader's order behind it. `sortBy` stays the first column
      // so nothing that only speaks the pagination contract is left sorting by nothing.
      sorts,
      sortDerived,
    });
    // The codes for the vehicles ON this page, in one query — bounded by the page, never by how
    // many vehicles the registry holds. And each row's gap AT ITS READING (D1), for the page only:
    // sorting by the column above still orders by the CAR's current figure.
    const [codes, gaps] = await Promise.all([
      fleetVehicleRepository.codesByIds(vehicleIdsOf(page.items)),
      loadServiceGaps(page.items),
    ]);
    return { ...page, codes, gaps };
  }

  /**
   * What the page is cut from — the resolved filters `list` describes, folded into one. The total
   * (`summary`) is counted from the very same filter, so it describes every row the list pages.
   */
  private async filterFor(
    query: FleetOdometerSummaryQuery,
    alarms: AlarmProjection = computeAlarms,
  ): Promise<FilterQuery<FleetOdometerLogDoc>> {
    const clause = await this.vehicleClause(query, alarms);
    return fleetOdometerRepository.logFilter({ ...query, ...clause });
  }

  /**
   * The vehicle half of the filter, resolved to ids:
   *
   *   • `vehicleCodes` — against the live registry, as this screen always has;
   *   • `alerts` — the derived maintenance level (FR-3), computed and then used to pick cars;
   *   • «النوع / التشغيل / الفرع» (`typeIds`, `operationIds`, `branchIds`, plan D10) — the vehicle set,
   *     deleted cars included, as the other registers resolve it (`resolveVehicleFilterIds`).
   *
   * All of them INTERSECT, and an empty intersection is a real answer (an empty page). The typed
   * codes may stand on their own — reaching a row kept from the old book on a car the registry never
   * had — only when nothing else narrowed the ids: such a row has no alarm level, type, operation or
   * branch to match.
   */
  private async vehicleClause(
    query: Pick<
      FleetOdometerSummaryQuery,
      'vehicleCodes' | 'alerts' | 'typeIds' | 'operationIds' | 'branchIds'
    >,
    // The request's own projection when the request may read it again (`list`'s alarm column).
    alarms: AlarmProjection = computeAlarms,
  ): Promise<OdometerVehicleClause> {
    const [byCode, byLevel, bySet] = await Promise.all([
      // The live cars carrying these codes — whitespace and Latin case aside, so «كورولا 1» is a
      // stored «كورولا 1 » (`anyVehicleCode`).
      query.vehicleCodes === undefined
        ? undefined
        : fleetVehicleRepository.liveIdsByCodes(query.vehicleCodes),
      query.alerts === undefined
        ? undefined
        : alarms().then((projected) => {
            const wanted = new Set<string>(query.alerts);
            return projected.filter((a) => wanted.has(a.level)).map((a) => a.vehicleId);
          }),
      resolveVehicleFilterIds(vehicleSetPart(query)),
    ]);
    return {
      vehicleIds: intersectVehicleIds(intersectVehicleIds(byCode, byLevel), bySet),
      vehicleCodes: byLevel === undefined && bySet === undefined ? query.vehicleCodes : undefined,
    };
  }

  /**
   * `GET /fleet/odometer/summary` — R-14 over the register's own filter: «إجمالي الكيلومترات» is the
   * sum of the km column of every row the list would page through, valid rows only; the closed rows
   * with negative km are «قراءات تحتاج مراجعة». The dashboard's period total is the same rows, so
   * the figure and the screen it links to agree by construction.
   */
  async summary(query: FleetOdometerSummaryQuery): Promise<FleetOdometerSummaryDto> {
    return fleetOdometerRepository.summaryOf(await this.filterFor(query));
  }

  /**
   * The filter `kmBreakdown` reads with: the register's vehicle filter over [from, to + 1] — the
   * window that holds every successor that can make a row single-day (R-15). Public so the plan
   * behind it can be explained in a spec; nothing else needs it.
   */
  async kmWindowFilter(query: OdometerKmQuery): Promise<FilterQuery<FleetOdometerLogDoc>> {
    const clause = await this.vehicleClause(query);
    return this.kmFilterOf(query, clause);
  }

  private kmFilterOf(
    query: OdometerKmQuery,
    clause: OdometerVehicleClause,
  ): FilterQuery<FleetOdometerLogDoc> {
    return fleetOdometerRepository.logFilter({
      vehicleId: query.vehicleId,
      ...clause,
      from: ymdToUtcDate(query.from),
      // `logFilter`'s `to` covers the whole day it names: [from, to + 1] in full.
      to: ymdToUtcDate(addDaysYmd(query.to, 1)),
    });
  }

  /**
   * The kilometres of a period, for the dashboard's tabs 6–8 (R-14…R-17): the total — the same rows
   * `summary` counts for `/fleet/odometer?from&to` with the same vehicle filter —, the daily (or
   * monthly) drawing with its confirmed, span, pending and stale parts, «مؤكدة حتى» and the average
   * line, the coverage, the km by the car's current branch (and type), and the rankings with the
   * cars that may not be ranked and why. The rules are `km-rules.ts`; this only gathers the facts.
   *
   * Reads: the rows dated in [from, to + 1] (never a car's whole history), the cars of the set and of
   * those rows, the cars a visit held throughout the period (R-16 (d) — any visit, not the newest),
   * each car's newest workshop visit («في الورشة منذ»), and the branch / type names.
   */
  async kmBreakdown(
    query: OdometerKmQuery,
    ctx: OdometerKmContext,
  ): Promise<FleetDashboardPeriodKmDto> {
    const clause = await this.vehicleClause(query);
    const setIds =
      query.vehicleId !== undefined
        ? intersectVehicleIds([query.vehicleId], clause.vehicleIds)
        : clause.vehicleIds;
    const [rows, everyLiveCar] = await Promise.all([
      fleetOdometerRepository.kmWindowRows(this.kmFilterOf(query, clause)),
      // Nothing narrows: the set is the whole registry, so coverage and the cars without readings
      // are asked of every live car.
      setIds === undefined
        ? fleetVehicleRepository.idsMatching({}).then((ids) => ids.map(String))
        : Promise.resolve([]),
    ]);
    const rowCars = rows.flatMap((row) => (row.vehicleId === null ? [] : [row.vehicleId]));
    const ids = [...new Set([...(setIds ?? everyLiveCar), ...rowCars])];
    const range = { from: query.from, to: query.to };
    const [docs, throughout, visits, branches] = await Promise.all([
      fleetVehicleRepository.findByIdsSystem(ids),
      fleetMaintenanceRepository.vehicleIdsInWorkshopThroughout(ids, range),
      fleetMaintenanceRepository.newestVisits(ids),
      branchRepository.listAll(),
    ]);
    const vehicles = new Map<string, KmVehicle>(
      docs.map((doc) => {
        const id = String(doc._id);
        const visit = visits.get(id);
        return [
          id,
          {
            vehicleId: id,
            code: doc.code,
            status: doc.status,
            isDeleted: doc.isDeleted,
            joinedAt: ymdOf(doc.joinedAt),
            branchId: doc.branchId === null ? null : String(doc.branchId),
            typeId: String(doc.typeId),
            visit:
              visit === undefined
                ? null
                : {
                    inDate: ymdOf(visit.inDate),
                    outDate: visit.outDate === null ? null : ymdOf(visit.outDate),
                  },
            workshopThroughout: throughout.has(id),
          },
        ];
      }),
    );
    const byType = ctx.branchId !== null;
    const typeIds = byType
      ? [
          ...new Set(
            [...vehicles.values()].flatMap((car) => (car.typeId === null ? [] : [car.typeId])),
          ),
        ]
      : [];
    const types =
      typeIds.length === 0 ? [] : await fleetVehicleTypeRepository.findByIdsSystem(typeIds);
    return kmBreakdownOf({
      rows,
      vehicles,
      setIds,
      range,
      today: ctx.today,
      staleDays: ctx.staleDays,
      byType,
      setNarrows: ctx.setNarrows,
      branchNames: new Map(branches.map((b) => [String(b._id), b.name as LocalizedString])),
      typeNames: new Map(types.map((type) => [String(type._id), type.name as LocalizedString])),
    });
  }

  /**
   * R-07 — «بلا قراءة عداد منذ N أيام»: every ACTIVE car (of `vehicleIds`, when given) with no open
   * workshop visit whose latest chain-reading date is before today − days; a car never read at all
   * is on its own line, never mixed in. Two bounded reads, never a whole-history `$group` for the
   * fleet: the cars read on or after the cutoff are found from the recent days alone, and only the
   * rest — normally a handful — are asked for their latest date.
   */
  async noReadingDigest(input: {
    today: string;
    days: number;
    vehicleIds?: readonly string[];
  }): Promise<OdometerNoReadingDigest> {
    const active = (await fleetVehicleRepository.idsMatching({ status: 'active' })).map(String);
    const candidates =
      input.vehicleIds === undefined
        ? active
        : (intersectVehicleIds(active, input.vehicleIds) ?? []);
    const inWorkshop = await fleetMaintenanceRepository.openVisitVehicleIds(candidates);
    const outside = candidates.filter((id) => !inWorkshop.has(id));
    const readSince = await fleetOdometerRepository.vehiclesReadSince(
      outside,
      missingReadingCutoff(input.today, input.days),
    );
    const unread = outside.filter((id) => !readSince.has(id));
    const [latest, codes] = await Promise.all([
      fleetOdometerRepository.latestChainDates(unread),
      fleetVehicleRepository.codesByIds(unread),
    ]);
    const byCode = <T extends { code: string }>(a: T, b: T): number =>
      compareFleetVehicleCodes(a.code, b.code);
    const codeOf = (id: string): string => codes.get(id) ?? '';
    return {
      stale: unread
        .flatMap((id) => {
          const lastDate = latest.get(id);
          return lastDate === undefined ? [] : [{ vehicleId: id, code: codeOf(id), lastDate }];
        })
        .sort(byCode),
      neverRead: unread
        .filter((id) => !latest.has(id))
        .map((id) => ({ vehicleId: id, code: codeOf(id) }))
        .sort(byCode),
    };
  }

  /**
   * The correction flow (owner FL-4 point 1) — `fleetOdometer.correct` only, fully audited.
   * A shared reading is ONE physical fact stored on two rows, so:
   *   - correcting `outReading` also rewrites the previous entry's `inReading` (+ its km);
   *   - correcting `inReading` (a closed entry) also rewrites the next entry's `outReading`;
   * and the corrected values must keep the whole chain ordered, or the correction is refused.
   *
   * «Previous» and «next» are the rows dated just before and after — the order `record()` splices
   * by — and what may change, and which neighbour moves with it, is `planCorrection`'s to say.
   */
  async correct(id: string, input: CorrectFleetOdometer, by: string): Promise<OdometerLogWithCode> {
    const changedFields: { field: string; old: string | null; new: string | null }[] = [];

    const { updated, vehicleId, bookCode } = await unitOfWork(async (session) => {
      const entry = await fleetOdometerRepository.getById(id);

      /*
       * A ROW KEPT FROM THE OLD BOOK FOR A CAR THE REGISTRY DOES NOT HAVE IS ON NO CAR'S CHAIN.
       *
       * Its neighbours would be looked up by `vehicleId: null` — which is every such row of every
       * unknown car at once — so a correction here could rewrite another car's reading. Refused
       * before anything is looked up; the row stays exactly as the book wrote it.
       */
      if (entry.vehicleId === null) {
        throw new ConflictError(
          'a reading kept from the old book for a car the registry does not have is on no car’s chain — it cannot be corrected here',
        );
      }

      /*
       * A DAY RECORDED WITH NO READING IS NOT CORRECTED HERE. It is on no chain — there are no
       * neighbours to check it against and no period to rewrite — so the two reading fields have
       * nothing to mean on it. The way to give that day a counter is to RECORD the reading for
       * that date, which splices into the chain properly; everything else about the day (who
       * drove, the note) is corrected exactly as on any other row.
       */
      if (
        entry.outReading === null &&
        (input.outReading !== undefined || input.inReading !== undefined)
      ) {
        throw invalid(
          'outReading',
          'this day was recorded without a reading — record the reading for that date instead of correcting this row',
        );
      }
      const { prev, next } =
        entry.outReading === null
          ? { prev: null, next: null }
          : await fleetOdometerRepository.findNeighbors(entry, session);

      // Only what this request changes is checked, and only a neighbour that shares the reading
      // is rewritten — see `correction-rules.ts` for the book shapes that makes necessary.
      const verdict = planCorrection(entry, input, prev, next);
      if ('refusal' in verdict) throw invalid(verdict.refusal.field, verdict.refusal.message);
      const { newOut, newIn, prevIn, nextOut } = verdict.plan;

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
      if (prev !== null && prevIn !== undefined) {
        await fleetOdometerRepository.updateById(
          String(prev._id),
          { inReading: prevIn, km: prevIn - (prev.outReading as number) },
          { by, version: prev.__v, session },
        );
      }
      if (next !== null && nextOut !== undefined) {
        await fleetOdometerRepository.updateById(
          String(next._id),
          {
            outReading: nextOut,
            km: next.inReading === null ? null : next.inReading - nextOut,
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
    // A reading kept from the old book for a car the registry never had names its car itself
    // (and, on no car's chain, carries no gap).
    if (vehicleId === null) return { doc: updated, vehicleCode: bookCode, serviceGapKm: null };
    return {
      doc: updated,
      vehicleCode: (await fleetVehicleRepository.codesByIds([vehicleId])).get(vehicleId) ?? null,
      serviceGapKm: await gapOf(updated),
    };
  }

  /**
   * «عاوز اقدر امسح قراءه» — a SOFT delete: the row leaves every screen and every figure and stays
   * in the database marked deleted, with who and when.
   *
   * The chain is re-linked around it. The reading before it closed ON this row's opening reading —
   * the one shared fact — so it now closes where this row closed: on the next reading's opening
   * (a middle row), or not at all (this was the open period, and the one before it is open again).
   * The first row, a day recorded with no reading, and a row from the old book with no registry car
   * have nothing before them to re-link and are simply removed. A reading before it that does NOT
   * close on this row (an old book that never chained) is left exactly as it is.
   *
   * «Before» is the row dated before it, as `record()` orders the chain — not the next lower
   * figure, which on a book typo is some other day entirely: deleting car 219's 118,722 of 30 July
   * found the open period of 29 September as its «previous» row and re-linked nothing.
   */
  async softDelete(id: string, by: string): Promise<void> {
    const relinked = await unitOfWork(async (session) => {
      const entry = await fleetOdometerRepository.getById(id);
      const { prev } =
        entry.outReading === null || entry.vehicleId === null
          ? { prev: null }
          : await fleetOdometerRepository.findNeighbors(entry, session);
      // First, so a reopened period never meets this one in the one-open-period index.
      await fleetOdometerRepository.softDeleteById(id, { by, session });
      if (prev === null || prev.inReading === null || prev.inReading !== entry.outReading) {
        return null;
      }
      const inReading = entry.inReading;
      await fleetOdometerRepository.updateById(
        String(prev._id),
        { inReading, km: inReading === null ? null : inReading - (prev.outReading as number) },
        { by, version: prev.__v, session },
      );
      return { id: String(prev._id), old: prev.inReading, new: inReading };
    });

    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
    if (relinked !== null) {
      await auditService.record({
        entityRef: entityRef(relinked.id),
        action: 'correct',
        changes: [
          {
            field: 'inReading',
            old: String(relinked.old),
            new: relinked.new === null ? null : String(relinked.new),
          },
        ],
      });
    }
  }
}

export const fleetOdometerService = new FleetOdometerService();
