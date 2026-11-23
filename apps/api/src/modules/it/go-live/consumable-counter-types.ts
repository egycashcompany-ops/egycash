// «حبارات» takes the printer's counter, ticked once by the deploy — the owner, 19 November 2026:
// «عند صرف الصنف : حبارة أو النوع : حبارات .. عايز يبقى فى Counter لعدد لورق المطبوع للطابعة اللى
// بيركب عليها الحبارة — يعني إجبارى أدخل عدد الورق المطبوع عند تركيب الحبارة», and of the flag
// «يتطلب عداد الطباعة» on the TYPE: ticked on «حبارات» from the start.
//
// WHY IT EXISTS. A fresh catalog's «حبارات» is born ticked (`consumable-types.ts`), but the live
// catalog's was seeded on 2026-11-17, before the flag, and that seed's run row means it never runs
// again. So the live row is ticked here, once, with the other types left as they are.
//
// THE IT TEAM'S ROW, FOUND AS THE SEED FINDS IT. The live «حبارات» is recognised by its code, or
// else by its Arabic name (`matchConsumableTypes`) — the IT team may have renamed or recoded it.
// A RETIRED one is ticked too, and reported retired: its items are toners all the same, and an
// issue of one still reads its type's flag. A type the IT team deleted is reported missing and
// nothing is made in its place. A row already ticked — the fresh catalog's, or the IT team's own
// on the catalogs page — is reported as such and not written.
//
// ONCE. A versioned run key: after the run row, a type the IT team unticks stays unticked.
//
// AFTER THE TYPES. It refuses — no run row, so the next boot tries again — until the types' own
// seed has run, and in the boot that seeds them it waits for that seed first
// (`itConsumableTypesSettled`), the opening stock's terms: otherwise a fresh database's first boot
// could tick nothing for having asked before the row existed, and then never again.
//
// ONE TRANSACTION, the go-live's terms (`go-live-run.model.ts`): the tick and the run row commit
// together or not at all, and a second process racing the first conflicts and finds the run row on
// its retry. The tick moves the row's version, so a catalog form opened before it answers 409 on
// save rather than writing over it. The audit rows follow the commit, as the catalog service's do —
// and through them the realtime refresh of a catalogs page somebody has open.
//
// HARMLESS EARLY. Both processes start it, and the worker boots the new build first: the old api
// never reads the flag, and its catalog PATCH `$set`s only the fields it knows.
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { ItCatalogItemModel } from '../catalog-items/catalog-item.model';
import {
  IT_COUNTER_READING_TYPE_CODES,
  matchConsumableTypes,
  type ItConsumableTypeCode,
} from './consumable-type-defaults';
import {
  IT_CONSUMABLE_TYPES_MARK,
  itConsumableTypesSettled,
  readConsumableTypes,
  type KeptConsumableType,
} from './consumable-types';
import {
  ensureItGoLiveRunIndexes,
  isItGoLiveRunDone,
  recordItGoLiveRun,
} from './go-live-run.model';

/** The run key — versioned, so another list is a decision and never a redeploy's accident. */
export const IT_CONSUMABLE_COUNTER_TYPES_MARK = 'go-live:it-consumable-counter-types:v1';

/** What the run row keeps — readable from the database, because the owner cannot read the log. */
export type ConsumableCounterTypesRunOutcome = {
  /** Ticked by this run. */
  flagged: KeptConsumableType[];
  /** Found ticked already — a fresh catalog's seed, or the IT team on the catalogs page. */
  alreadyFlagged: KeptConsumableType[];
  /** Not in the catalog at all (the IT team deleted it): nothing is made in its place. */
  missing: ItConsumableTypeCode[];
};

export type ConsumableCounterTypesOutcome =
  | { status: 'alreadyDone' }
  | { status: 'refused'; reason: 'typesNotSeeded' }
  | ({ status: 'done' } & ConsumableCounterTypesRunOutcome);

/** Run the tick. Exported so a test can drive it against a real database. */
export const flagItConsumableCounterTypes = async (): Promise<ConsumableCounterTypesOutcome> => {
  // 0. A run that is done is asked first, outside any transaction, so a boot after it reads
  //    nothing. The check inside the transaction still settles two processes racing.
  if (await isItGoLiveRunDone(IT_CONSUMABLE_COUNTER_TYPES_MARK)) return { status: 'alreadyDone' };

  // 1. The types first. Their run row, once written, is never taken back — so asked once, here.
  if (!(await isItGoLiveRunDone(IT_CONSUMABLE_TYPES_MARK))) {
    return { status: 'refused', reason: 'typesNotSeeded' };
  }

  // 2. The indexes before the transaction writes — `autoIndex` is off in production, and the run
  //    row's unique key is what turns a racing twin into a refusal.
  await Promise.all([ItCatalogItemModel.createIndexes(), ensureItGoLiveRunIndexes()]);

  const run = await unitOfWork(async (session) => {
    if (await isItGoLiveRunDone(IT_CONSUMABLE_COUNTER_TYPES_MARK, session)) {
      return { kind: 'alreadyDone' as const };
    }

    // Read inside the transaction, so a type the IT team renamed or ticked a moment ago is seen
    // as it now stands.
    const matches = matchConsumableTypes(await readConsumableTypes(session));
    const outcome: ConsumableCounterTypesRunOutcome = {
      flagged: [],
      alreadyFlagged: [],
      missing: [],
    };
    for (const code of IT_COUNTER_READING_TYPE_CODES) {
      const match = matches.get(code) ?? { kind: 'missing' as const };
      if (match.kind === 'missing') {
        outcome.missing.push(code);
        continue;
      }
      const entry: KeptConsumableType = {
        code,
        id: match.type.id,
        name: match.type.name.ar,
        by: match.by,
        active: match.kind === 'found',
      };
      // `$ne: true` matches a row from before the flag (no key) and an unticked one alike; the
      // version moves, so a form opened before the tick cannot save over it. The edit is nobody's
      // hand, as every go-live write.
      const result = await ItCatalogItemModel.updateOne(
        { _id: match.type.id, isDeleted: false, requiresCounterReading: { $ne: true } },
        { $set: { requiresCounterReading: true, updatedBy: null }, $inc: { __v: 1 } },
        { session },
      ).exec();
      (result.modifiedCount === 1 ? outcome.flagged : outcome.alreadyFlagged).push(entry);
    }

    await recordItGoLiveRun(IT_CONSUMABLE_COUNTER_TYPES_MARK, outcome, session);
    return { kind: 'done' as const, outcome };
  });

  if (run.kind === 'alreadyDone') return { status: 'alreadyDone' };

  // After the commit, as the catalog service writes its own: the audit trail, and the realtime
  // refresh of a catalogs page somebody has open. A row from before the flag read false.
  for (const type of run.outcome.flagged) {
    await auditService.record({
      entityRef: { moduleId: 'it', entityType: 'catalogItem', entityId: type.id },
      action: 'update',
      changes: [
        { field: 'requiresCounterReading', old: false, new: true },
        { field: 'source', old: null, new: IT_CONSUMABLE_COUNTER_TYPES_MARK },
      ],
    });
  }
  return { status: 'done', ...run.outcome };
};

/** Run it once and say what happened. Exported so a test can await it. */
export const runItConsumableCounterTypesGoLive = async (): Promise<void> => {
  // Started in the same boot as the types it ticks: let them land first.
  await itConsumableTypesSettled();
  const outcome = await flagItConsumableCounterTypes();
  if (outcome.status === 'refused') {
    logger.warn(
      { reason: outcome.reason },
      'it go-live: «حبارات» was NOT given the printer counter — the consumable types are not seeded yet; the next boot tries again',
    );
  } else if (outcome.status === 'done') {
    logger.warn(
      outcome,
      'it go-live: the consumable types that take the printer counter were ticked — done, and never again',
    );
  }
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — the inventory's terms.
 */
export const startItConsumableCounterTypesGoLive = (): void => {
  if (isTest) return;
  void runItConsumableCounterTypesGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'it go-live: ticking the printer counter on the consumable types failed — no boot was harmed',
    );
  });
};
