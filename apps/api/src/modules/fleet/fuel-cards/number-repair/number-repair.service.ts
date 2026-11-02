// «تصحيح أرقام الكروت» (6d) — the live dry run, and the execution the owner presses after reviewing it.
//
// NOTHING RUNS BY ITSELF: no boot step, no migration, no schedule. The dry run reads; only
// `execute` writes, and only the units the reviewed dry run showed ready and the body names.
//
// EXECUTION — the units in their fixed order (C4, C5, C6, pair), EACH IN ONE TRANSACTION: the unit
// is re-read and re-planned inside it (a record changed since the review holds its whole unit; a
// unit already done is skipped), then written whole. A cycle goes through temporary numbers first
// (`6d-tmp-<cardId>`): `ux_fuel_card_number` refuses a cycle of numbers moved one at a time. Each
// record then takes the right number with the PIN (as stored — never decrypted, read out, logged or
// returned), the photo and the expiry the card that held it has at that moment; its name, car,
// balance and log stay. The photo's Files rows (and its thumbnail's) are re-pointed at the record
// that now shows it, in the same transaction — so the Files authorizers ask about that card.
// The pair swaps its names and moves each balance by the go-live opening's difference. Every record
// gets one `dataFix` line in the same transaction — the lines are what make a unit read «done», so
// a re-run is a no-op — and, after the commit, one audit row (which also refreshes every open fuel
// screen). An unexpected error rolls back the unit it happened in and stops the request; the units
// committed before it stay, complete; a re-run continues.
//
// No card document, donor, or update payload is ever logged or put in an error.
import { Types, type ClientSession } from 'mongoose';
import {
  ErrorCodes,
  FLEET_FUEL_NUMBER_REPAIR_TOP_UPS,
  FLEET_FUEL_NUMBER_REPAIR_UNITS,
  type ExecuteFleetFuelNumberRepair,
  type FleetFuelNumberRepairChangeDto,
  type FleetFuelNumberRepairCycleDto,
  type FleetFuelNumberRepairDto,
  type FleetFuelNumberRepairLogDto,
  type FleetFuelNumberRepairPairDto,
  type FleetFuelNumberRepairPairRowDto,
  type FleetFuelNumberRepairPhotoDto,
  type FleetFuelNumberRepairResultDto,
  type FleetFuelNumberRepairTopUpDto,
  type FleetFuelNumberRepairUnit,
  type ListAuditLogsQuery,
  type AuditChange,
} from '@ecms/contracts';
import { AppError, StaleDocumentError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { fileService } from '../../../../platform/files';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../../shared/utils/diff';
import { actorNamesOf } from '../../fleet-actor-name';
import { fleetFuelCardMovementRepository, fleetFuelCardRepository } from '../fuel-card.repository';
import {
  FleetFuelCardMovementModel,
  type FleetFuelCardDoc,
  type FleetFuelCardMovementDoc,
} from '../fuel-card.model';
import { fuelCardEntityRef, fuelCardSnapshot } from '../fuel-card.service';
import { hasThumb } from '../fuel-card-thumbs';
import {
  FUEL_NUMBER_REPAIR_GO_LIVE_DAY,
  FUEL_NUMBER_REPAIR_KEY,
  FUEL_NUMBER_REPAIR_STATEMENT,
  REPAIR_CYCLES,
  REPAIR_PAIR,
  REPAIR_PAIR_NUMBERS,
  REPAIR_RECORDS,
  type RepairPhotoEvidence,
} from './number-repair-definition';
import {
  goLivePhotoNumber,
  last4,
  planPair,
  planRepair,
  planUnit,
  type PlannedCycle,
  type PlannedPair,
  type PlannedRow,
  type RepairWorld,
} from './number-repair-plan';
import { readRepairWorld, type RepairRead } from './number-repair.repository';

const piastres = (egp: number): number => Math.round(egp * 100);
const NUMBER_PREFIX = (number: string): string => number.replace(/\D/gu, '').slice(0, 3);
/** A number no card can hold — letters — while a cycle's numbers change places. */
const temporaryNumber = (cardId: string): string => `6d-tmp-${cardId}`;
const dayDate = (day: string | null): Date | null =>
  day === null ? null : new Date(`${day}T00:00:00.000Z`);
/** How many times a unit is re-planned after another writer got there first. */
const UNIT_ATTEMPTS = 3;

/** The audit field each change is found under. */
const AUDIT_FIELD: Partial<Record<FleetFuelNumberRepairChangeDto['field'], string>> = {
  number: 'number',
  name: 'name',
  vehicle: 'vehicleId',
  expiry: 'expiresAt',
  photo: 'image',
  pin: 'hasPassword',
};

/** What one unit's transaction did. */
type UnitOutcome =
  | { kind: 'alreadyDone' | 'held' }
  | {
      kind: 'executed';
      audits: { cardId: string; changes: AuditChange[] }[];
    };

/** The refusal of an unexpected failure — generic on purpose: nothing of a card goes in it. */
const unitFailed = (unit: FleetFuelNumberRepairUnit, cause: unknown): AppError =>
  new AppError(
    ErrorCodes.INTERNAL,
    500,
    `the card-number repair stopped in unit ${unit} — that unit was rolled back and nothing of it was written; the units before it are complete`,
    { cause, expected: false },
  );

class FleetFuelNumberRepairService {
  // ── The lock the batch-3 reconciliation asks about ─────────────────────────

  /**
   * The 0849 pair's numbers while the pair is not repaired — what «مطابقة أرصدة الكروت» holds back
   * («ضمن تصحيح الأرقام»): the link ✓ (6b) and the balance ✓ (6c) of those two cards. `[]` once the
   * pair's two `dataFix` lines are written — wherever its two cards are later moved, replaced or
   * deleted. Read live, so the lock lifts with the repair itself.
   */
  async pairNumbersInRepair(): Promise<string[]> {
    const { world } = await readRepairWorld(
      null,
      REPAIR_PAIR.map((record) => record.car),
    );
    return planPair(world).state === 'done' ? [] : [...REPAIR_PAIR_NUMBERS];
  }

  // ── The dry run ─────────────────────────────────────────────────────────────

  async dryRun(): Promise<FleetFuelNumberRepairDto> {
    const readAt = new Date();
    const read = await readRepairWorld();
    return this.toDto(read, readAt);
  }

  private async toDto(read: RepairRead, readAt: Date): Promise<FleetFuelNumberRepairDto> {
    const { world, docs, lineDocs } = read;
    const plan = planRepair(world);
    const cardIds = [...world.byCar.values()].map((card) => card.id);
    const pairIds = plan.pair.rows.flatMap((row) => (row.card === null ? [] : [row.card.id]));
    const [charges, adjustments] = await Promise.all([
      cardIds.length === 0
        ? []
        : FleetFuelCardMovementModel.find({
            cardId: { $in: cardIds.map((id) => new Types.ObjectId(id)) },
            kind: 'charge',
            isDeleted: false,
          })
            .sort({ at: 1, _id: 1 })
            .lean<FleetFuelCardMovementDoc[]>()
            .exec(),
      pairIds.length === 0
        ? []
        : FleetFuelCardMovementModel.find({
            cardId: { $in: pairIds.map((id) => new Types.ObjectId(id)) },
            kind: 'sheetAdjust',
            isDeleted: false,
          })
            .sort({ at: 1, _id: 1 })
            .lean<FleetFuelCardMovementDoc[]>()
            .exec(),
    ]);
    const chargesOf = new Map<string, FleetFuelCardMovementDoc[]>();
    for (const charge of charges) {
      const list = chargesOf.get(String(charge.cardId)) ?? [];
      list.push(charge);
      chargesOf.set(String(charge.cardId), list);
    }
    const allRows = [...plan.cycles.flatMap((cycle) => cycle.rows), ...plan.pair.rows];
    const changed = await this.changeAuthors(allRows);
    const names = await actorNamesOf([
      ...lineDocs.map((line) => (line.createdBy == null ? null : String(line.createdBy))),
      ...[...changed.values()].map((found) => found.by),
    ]);

    const topUpsOf = (
      row: PlannedRow,
    ): { topUps: FleetFuelNumberRepairTopUpDto[]; topUpsMore: number } => {
      const list = row.card === null ? [] : (chargesOf.get(row.card.id) ?? []);
      return {
        topUps: list.slice(0, FLEET_FUEL_NUMBER_REPAIR_TOP_UPS).map((charge) => ({
          id: String(charge._id),
          at: charge.at.toISOString(),
          amount: charge.amount,
          cancelledBySheet: charge.cancelledBySheet != null,
        })),
        topUpsMore: Math.max(0, list.length - FLEET_FUEL_NUMBER_REPAIR_TOP_UPS),
      };
    };
    const changesOf = (row: PlannedRow): FleetFuelNumberRepairChangeDto[] =>
      row.changes.map((change) => {
        const found = row.card === null ? undefined : changed.get(`${row.card.id}:${change.field}`);
        return {
          ...change,
          at: found?.at.toISOString() ?? null,
          byName: found?.by == null ? null : (names.get(found.by) ?? null),
        };
      });
    const logOf = (row: PlannedRow): FleetFuelNumberRepairLogDto | null =>
      row.line === null
        ? null
        : {
            movementId: row.line.movementId,
            at: row.line.at.toISOString(),
            byName: row.line.by == null ? null : (names.get(row.line.by) ?? null),
          };
    // A go-live photo is wherever its number's card is now — found by the photo itself; one
    // replaced since (a clearer photo of the same card) is on the card holding the number.
    const photoOf = (
      number: string,
      evidence: RepairPhotoEvidence,
    ): FleetFuelNumberRepairPhotoDto => {
      const holding = world.byNumber.get(number);
      const holder =
        [...world.byCar.values(), ...world.byNumber.values()].find(
          (card) => goLivePhotoNumber(card.image) === number,
        ) ?? (holding?.image == null ? undefined : holding);
      const doc = holder === undefined ? undefined : docs.get(holder.id);
      return {
        cardId: holder?.id ?? null,
        thumb: doc !== undefined && hasThumb(doc.image),
        ...evidence,
        last4: last4(number),
      };
    };

    // The expiry and the PIN (yes/no) of a physical card as stored today — they travel with its
    // number; the definition's, should no live card hold the number.
    const factsOf = (
      number: string,
      fallback: { expiresAt: string; hasPin: boolean },
    ): { expiresAt: string; hasPin: boolean } => {
      const holding = world.byNumber.get(number);
      return holding === undefined
        ? fallback
        : { expiresAt: holding.expiresAt ?? fallback.expiresAt, hasPin: holding.hasPin };
    };

    const parts: DtoParts = { topUpsOf, changesOf, logOf, photoOf, factsOf };
    const cycles: FleetFuelNumberRepairCycleDto[] = plan.cycles.map((cycle) =>
      this.cycleDto(cycle, parts),
    );
    const pair = this.pairDto(plan.pair, adjustments, world, parts);

    const units = [...plan.cycles, plan.pair];
    const recordsIn = (state: string): number =>
      units.filter((unit) => unit.state === state).reduce((sum, unit) => sum + unit.rows.length, 0);
    const doneUnits = units.filter((unit) => unit.state === 'done').length;
    const newest = lineDocs.at(-1);
    return {
      key: FUEL_NUMBER_REPAIR_KEY,
      company: 'wataniya',
      goLiveDay: FUEL_NUMBER_REPAIR_GO_LIVE_DAY,
      readAt: readAt.toISOString(),
      state: doneUnits === 0 ? 'pending' : doneUnits === units.length ? 'done' : 'partial',
      executedAt: newest?.at.toISOString() ?? null,
      executedByName:
        newest?.createdBy == null ? null : (names.get(String(newest.createdBy)) ?? null),
      counts: {
        records: REPAIR_RECORDS.length + REPAIR_PAIR.length,
        crossed: REPAIR_RECORDS.length,
        pair: REPAIR_PAIR.length,
        ready: recordsIn('ready'),
        held: recordsIn('held'),
        done: recordsIn('done'),
      },
      readyUnits: units.filter((unit) => unit.state === 'ready').map((unit) => unit.unit),
      noPinAfterCars: plan.cycles.flatMap((cycle) =>
        cycle.state === 'held'
          ? []
          : cycle.records.flatMap((record, i) => {
              const card = cycle.rows[i]?.card ?? null;
              // Ready: the PIN the right number's card holds now is the one that comes with it.
              const none =
                cycle.state === 'ready'
                  ? !factsOf(record.after.number, record.after).hasPin
                  : card !== null && !card.hasPin;
              return none ? [record.car] : [];
            }),
      ),
      cycles,
      pair,
    };
  }

  private cycleDto(cycle: PlannedCycle, parts: DtoParts): FleetFuelNumberRepairCycleDto {
    const definition = REPAIR_CYCLES.find((c) => c.unit === cycle.unit);
    const records = cycle.records;
    return {
      unit: cycle.unit,
      n: definition?.n ?? 1,
      cars: records.map((record) => record.car),
      heldLast4: records.map((record) => last4(record.before.number)),
      state: cycle.state,
      rows: records.map((record, i) => {
        const row = cycle.rows[i] as PlannedRow;
        const previous = records[(i - 1 + records.length) % records.length] as typeof record;
        const next = records[(i + 1) % records.length] as typeof record;
        const before = parts.factsOf(record.before.number, record.before);
        const after = parts.factsOf(record.after.number, record.after);
        return {
          car: record.car,
          name: record.name,
          cardId: row.card?.id ?? null,
          balance: row.card?.balance ?? null,
          state: row.state,
          numberPrefix: NUMBER_PREFIX(record.before.number),
          numberBeforeLast4: last4(record.before.number),
          numberAfterLast4: last4(record.after.number),
          afterIsNowOnCar: previous.car,
          beforeGoesToCar: next.car,
          expiryBefore: before.expiresAt,
          expiryAfter: after.expiresAt,
          pinBefore: before.hasPin,
          pinAfter: after.hasPin,
          photoBefore: parts.photoOf(record.before.number, record.photoBefore),
          photoAfter: parts.photoOf(record.after.number, record.photoAfter),
          chassisTypo: record.chassisTypo,
          ...parts.topUpsOf(row),
          changes: parts.changesOf(row),
          log: parts.logOf(row),
        };
      }),
    };
  }

  private pairDto(
    pair: PlannedPair,
    adjustments: FleetFuelCardMovementDoc[],
    world: RepairWorld,
    parts: DtoParts,
  ): FleetFuelNumberRepairPairDto {
    const rows = pair.records.map((record, i): FleetFuelNumberRepairPairRowDto => {
      const row = pair.rows[i] as PlannedRow;
      const balance = row.card?.balance ?? null;
      const facts = parts.factsOf(record.number, record);
      return {
        car: record.car,
        cardId: row.card?.id ?? null,
        state: row.state,
        numberPrefix: NUMBER_PREFIX(record.number),
        numberLast4: last4(record.number),
        expiry: facts.expiresAt,
        hasPin: facts.hasPin,
        nameBefore: record.nameBefore,
        nameAfter: record.nameAfter,
        openingBefore: record.openingBefore,
        openingAfter: record.openingAfter,
        delta: record.delta,
        balance,
        balanceAfter:
          balance === null
            ? null
            : pair.state === 'done'
              ? balance
              : (piastres(balance) + piastres(record.delta)) / 100,
        statementOpening: record.statementOpening,
        statementDay: FUEL_NUMBER_REPAIR_STATEMENT.day,
        photo: parts.photoOf(record.number, record.photo),
        ...parts.topUpsOf(row),
        changes: parts.changesOf(row),
        log: parts.logOf(row),
      };
    }) as [FleetFuelNumberRepairPairRowDto, FleetFuelNumberRepairPairRowDto];
    const carOf = new Map([...world.byCar.entries()].map(([car, card]) => [card.id, car] as const));
    return {
      state: pair.state,
      rows,
      sheetAdjustments: adjustments.map((line) => ({
        cardId: String(line.cardId),
        car: carOf.get(String(line.cardId)) ?? '',
        movementId: String(line._id),
        at: line.at.toISOString(),
        amount: line.amount,
        balanceAfter: line.balanceAfter,
        fileName: line.reconciliation?.fileName ?? '',
      })),
    };
  }

  /**
   * When, and by whom, each changed record's field was last changed — the newest audit row on that
   * card naming the field. Keyed `<cardId>:<field>`.
   */
  private async changeAuthors(
    rows: readonly PlannedRow[],
  ): Promise<Map<string, { at: Date; by: string | null }>> {
    const found = new Map<string, { at: Date; by: string | null }>();
    await Promise.all(
      rows
        .filter((row) => row.card !== null && row.changes.length > 0)
        .map(async (row) => {
          const card = row.card as NonNullable<PlannedRow['card']>;
          const page = await auditService.listAuditLogs({
            moduleId: 'fleet',
            entityType: 'fuelCard',
            entityId: card.id,
            page: 1,
            pageSize: 50,
            sortDir: 'desc',
          } satisfies ListAuditLogsQuery);
          for (const change of row.changes) {
            const field = AUDIT_FIELD[change.field];
            if (field === undefined) continue;
            const newest = page.items.find((item) =>
              item.changes.some((entry) => entry.field === field),
            );
            if (newest !== undefined) {
              found.set(`${card.id}:${change.field}`, {
                at: newest.at,
                by: newest.actor.userId == null ? null : String(newest.actor.userId),
              });
            }
          }
        }),
    );
    return found;
  }

  // ── Execution ───────────────────────────────────────────────────────────────

  async execute(
    ctx: AuthContext,
    input: ExecuteFleetFuelNumberRepair,
  ): Promise<FleetFuelNumberRepairResultDto> {
    const by = ctx.userId;
    const at = new Date();
    const requested = new Set<FleetFuelNumberRepairUnit>(input.units);
    const result: Pick<
      FleetFuelNumberRepairResultDto,
      'executed' | 'alreadyDone' | 'held' | 'notRequested'
    > = { executed: [], alreadyDone: [], held: [], notRequested: [] };
    const before = planRepair((await readRepairWorld()).world);
    const stateBefore = new Map(
      [...before.cycles, before.pair].map((unit) => [unit.unit, unit.state] as const),
    );
    for (const unit of FLEET_FUEL_NUMBER_REPAIR_UNITS) {
      if (!requested.has(unit)) {
        if (stateBefore.get(unit) === 'ready') result.notRequested.push(unit);
        continue;
      }
      const outcome = await this.runUnit(unit, by, at);
      if (outcome.kind === 'executed') {
        for (const audit of outcome.audits) {
          await auditService.record({
            entityRef: fuelCardEntityRef(audit.cardId),
            action: 'correct',
            changes: audit.changes,
          });
        }
        result.executed.push(unit);
      } else {
        result[outcome.kind].push(unit);
      }
    }
    return { at: at.toISOString(), ...result, repair: await this.dryRun() };
  }

  /** One unit, in one transaction — re-planned inside it, written whole or not at all. */
  private async runUnit(
    unit: FleetFuelNumberRepairUnit,
    by: string,
    at: Date,
  ): Promise<UnitOutcome> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await unitOfWork((session) => this.writeUnit(unit, by, at, session));
      } catch (error) {
        // Another writer changed a record between this transaction's read and its write: re-plan
        // (the unit then reads held, or done).
        if (error instanceof StaleDocumentError && attempt < UNIT_ATTEMPTS) continue;
        if (error instanceof AppError && error.httpStatus < 500) throw error;
        throw unitFailed(unit, error);
      }
    }
  }

  private async writeUnit(
    unit: FleetFuelNumberRepairUnit,
    by: string,
    at: Date,
    session: ClientSession,
  ): Promise<UnitOutcome> {
    const { world, docs } = await readRepairWorld(session);
    const planned = planUnit(unit, world);
    if (planned.state === 'done') return { kind: 'alreadyDone' };
    if (planned.state === 'held') return { kind: 'held' };
    const audits: { cardId: string; changes: AuditChange[] }[] = [];
    const tag = { field: 'dataFix', old: null, new: `${FUEL_NUMBER_REPAIR_KEY}:${unit}` };

    if (planned.unit === 'pair') {
      for (const write of planned.writes) {
        const card = docs.get(write.cardId) as FleetFuelCardDoc;
        const balance = (piastres(write.balance) + piastres(write.delta)) / 100;
        const updated = await fleetFuelCardRepository.updateById(
          write.cardId,
          { name: write.nameAfter, balance },
          { by, version: write.version, session },
        );
        await fleetFuelCardMovementRepository.create(
          {
            cardId: card._id,
            kind: 'dataFix',
            amount: write.delta,
            balanceAfter: balance,
            counterpartCardId: null,
            receiptId: null,
            at,
            repair: {
              key: FUEL_NUMBER_REPAIR_KEY,
              unit,
              kind: 'nameSwap',
              numberBefore: null,
              numberAfter: null,
              pinMoved: null,
              photoMoved: null,
              expiryBefore: null,
              expiryAfter: null,
              nameBefore: write.nameBefore,
              nameAfter: write.nameAfter,
              openingBefore: write.openingBefore,
              openingAfter: write.openingAfter,
            },
          },
          { by, session },
        );
        audits.push({
          cardId: write.cardId,
          changes: [
            ...diffChanges(fuelCardSnapshot(card), fuelCardSnapshot(updated)),
            { field: 'balance', old: String(write.balance), new: String(balance) },
            tag,
          ],
        });
      }
      return { kind: 'executed', audits };
    }

    // A cycle. The donors — what each record receives — read in this transaction, kept in memory.
    const donors = new Map(
      planned.writes.map((write) => {
        const donor = docs.get(write.takeFrom) as FleetFuelCardDoc;
        if (donor.number !== write.numberAfter) throw new Error('the cycle does not close');
        return [
          write.cardId,
          {
            password: donor.password ?? null,
            image: donor.image ?? null,
            expiresAt: donor.expiresAt ?? null,
          },
        ] as const;
      }),
    );
    // Phase 1 — free every number of the cycle.
    const versions = new Map<string, number>();
    for (const write of planned.writes) {
      const freed = await fleetFuelCardRepository.updateById(
        write.cardId,
        { number: temporaryNumber(write.cardId) },
        { by, version: write.version, session },
      );
      versions.set(write.cardId, freed.__v);
    }
    // Phase 2 — the right number, with the PIN, photo and expiry of the card that held it.
    for (const write of planned.writes) {
      const card = docs.get(write.cardId) as FleetFuelCardDoc;
      const donor = donors.get(write.cardId) as NonNullable<ReturnType<typeof donors.get>>;
      // The photo's Files rows follow it — and its thumbnail's — so every Files check of that
      // photo asks about the card that shows it from now on, not the card it came from.
      if (donor.image != null) {
        await fileService.reassignEntity(
          String(donor.image.fileId),
          fuelCardEntityRef(write.cardId),
          session,
        );
        if (donor.image.thumb != null) {
          await fileService.reassignEntity(
            String(donor.image.thumb.fileId),
            { moduleId: 'fleet', entityType: 'fuelCardThumb', entityId: write.cardId },
            session,
          );
        }
      }
      const updated = await fleetFuelCardRepository.updateById(
        write.cardId,
        {
          number: write.numberAfter,
          password: donor.password,
          image: donor.image,
          expiresAt: donor.expiresAt,
        },
        { by, version: versions.get(write.cardId) as number, session },
      );
      await fleetFuelCardMovementRepository.create(
        {
          cardId: card._id,
          kind: 'dataFix',
          amount: 0,
          balanceAfter: write.balance,
          counterpartCardId: null,
          receiptId: null,
          at,
          repair: {
            key: FUEL_NUMBER_REPAIR_KEY,
            unit,
            kind: 'number',
            numberBefore: write.numberBefore,
            numberAfter: write.numberAfter,
            pinMoved: donor.password != null && donor.password !== '',
            photoMoved: donor.image != null,
            expiryBefore: dayDate(write.expiryBefore),
            expiryAfter: dayDate(write.expiryAfter),
            nameBefore: null,
            nameAfter: null,
            openingBefore: null,
            openingAfter: null,
          },
        },
        { by, session },
      );
      // The snapshot carries `hasPassword`, never the PIN.
      audits.push({
        cardId: write.cardId,
        changes: [
          ...diffChanges(fuelCardSnapshot(card), fuelCardSnapshot(updated)),
          {
            field: 'image',
            old: card.image == null ? null : String(card.image.fileId),
            new: donor.image == null ? null : String(donor.image.fileId),
          },
          tag,
        ],
      });
    }
    return { kind: 'executed', audits };
  }
}

interface DtoParts {
  topUpsOf: (row: PlannedRow) => {
    topUps: FleetFuelNumberRepairTopUpDto[];
    topUpsMore: number;
  };
  changesOf: (row: PlannedRow) => FleetFuelNumberRepairChangeDto[];
  logOf: (row: PlannedRow) => FleetFuelNumberRepairLogDto | null;
  photoOf: (number: string, evidence: RepairPhotoEvidence) => FleetFuelNumberRepairPhotoDto;
  factsOf: (
    number: string,
    fallback: { expiresAt: string; hasPin: boolean },
  ) => { expiresAt: string; hasPin: boolean };
}

export const fleetFuelNumberRepairService = new FleetFuelNumberRepairService();
