// The consumables' types, seeded once by the deploy — «للمستهلكات زي: حبارات - كابلات بأنواعها -
// كونفرترات (محولات) بأنواعها - ماوس - كيبرود - رامات - هاردات - فلاشات - وهكذا».
//
// The kind is new (FR-20): a catalog that has never had it holds none of these, and the consumables
// screen cannot file an item under a type that does not exist. The nine the owner approved
// (`consumable-type-defaults.ts`) are written as ordinary catalog rows the IT team edits, renames or
// retires on the catalogs page like any other — the seed decides the first list, never the list.
//
// NEVER OVER THE IT TEAM'S OWN. A type the catalog already holds — by the code or by the Arabic
// name, retired or not — is left exactly as it is and nothing is seeded beside it. And it is done
// ONCE: after the run row, a type the IT team deletes stays deleted. Another list is another key.
//
// ONE TRANSACTION, the go-live's terms (`go-live-run.model.ts`): the rows and the run row commit
// together or not at all, and a second process racing the first conflicts and finds the run row on
// its retry. The audit rows follow the commit, as the catalog service's do.
import { Types, type ClientSession } from 'mongoose';
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import { ItCatalogItemModel, type ItCatalogItemDoc } from '../catalog-items/catalog-item.model';
import {
  IT_CONSUMABLE_TYPE_CODES,
  IT_CONSUMABLE_TYPE_NAMES,
  consumableTypeSortOrder,
  matchConsumableTypes,
  type ItConsumableTypeCode,
  type LiveConsumableType,
} from './consumable-type-defaults';
import {
  ensureItGoLiveRunIndexes,
  isItGoLiveRunDone,
  recordItGoLiveRun,
} from './go-live-run.model';

/** The run key — versioned, so another list is a decision and never a redeploy's accident. */
export const IT_CONSUMABLE_TYPES_MARK = 'go-live:it-consumable-types:v1';

/** One of the nine the catalog already held, and how it was recognised. */
export interface KeptConsumableType {
  code: ItConsumableTypeCode;
  id: string;
  name: string;
  by: 'code' | 'name';
  active: boolean;
}

export type ConsumableTypesOutcome =
  | { status: 'alreadyDone' }
  | { status: 'done'; created: ItConsumableTypeCode[]; kept: KeptConsumableType[] };

type SeededType = Pick<
  ItCatalogItemDoc,
  'kind' | 'name' | 'description' | 'sortOrder' | 'isActive'
> & { _id: Types.ObjectId; code: ItConsumableTypeCode };

/**
 * The consumable types the catalog holds now, oldest first — never a deleted one, never another
 * kind's row of the same name. Read inside the caller's transaction; the opening stock reads its
 * types here too, so both steps see the catalog the same way.
 */
export const readConsumableTypes = async (
  session: ClientSession,
): Promise<LiveConsumableType[]> => {
  const rows = await ItCatalogItemModel.find({ kind: 'consumableType', isDeleted: false })
    .select({ code: 1, name: 1, isActive: 1 })
    .sort({ _id: 1 })
    .session(session)
    .lean<Pick<ItCatalogItemDoc, '_id' | 'code' | 'name' | 'isActive'>[]>()
    .exec();
  return rows.map((row) => ({
    id: String(row._id),
    code: row.code,
    name: { ar: row.name.ar, en: row.name.en },
    isActive: row.isActive,
  }));
};

/** Run the seed. Exported so a test can drive it against a real database. */
export const seedItConsumableTypes = async (): Promise<ConsumableTypesOutcome> => {
  // 0. A run that is done is asked first, outside any transaction, so a boot after it reads
  //    nothing. The check inside the transaction still settles two processes racing.
  if (await isItGoLiveRunDone(IT_CONSUMABLE_TYPES_MARK)) return { status: 'alreadyDone' };

  // 1. The indexes before the transaction inserts — `autoIndex` is off in production, and the
  //    catalog's unique Arabic name is what turns a racing twin into a refusal.
  await Promise.all([ItCatalogItemModel.createIndexes(), ensureItGoLiveRunIndexes()]);

  const run = await unitOfWork(async (session) => {
    if (await isItGoLiveRunDone(IT_CONSUMABLE_TYPES_MARK, session)) {
      return { kind: 'alreadyDone' as const };
    }

    // Read inside the transaction, so a type the IT team added a moment ago is seen too.
    const matches = matchConsumableTypes(await readConsumableTypes(session));
    const kept: KeptConsumableType[] = [];
    const created: SeededType[] = [];
    for (const code of IT_CONSUMABLE_TYPE_CODES) {
      const match = matches.get(code) ?? { kind: 'missing' as const };
      if (match.kind !== 'missing') {
        kept.push({
          code,
          id: match.type.id,
          name: match.type.name.ar,
          by: match.by,
          active: match.kind === 'found',
        });
        continue;
      }
      created.push({
        _id: new Types.ObjectId(),
        kind: 'consumableType',
        code,
        name: { ...IT_CONSUMABLE_TYPE_NAMES[code] },
        description: null,
        sortOrder: consumableTypeSortOrder(code),
        isActive: true,
      });
    }
    if (created.length > 0) await ItCatalogItemModel.insertMany(created, { session });

    const outcome = { created: created.map((type) => type.code), kept };
    await recordItGoLiveRun(IT_CONSUMABLE_TYPES_MARK, outcome, session);
    return { kind: 'done' as const, outcome, created };
  });

  if (run.kind === 'alreadyDone') return { status: 'alreadyDone' };

  // After the commit, as the catalog service writes its own: the audit trail — and through it the
  // realtime refresh of a catalogs page somebody has open.
  for (const type of run.created) {
    await auditService.record({
      entityRef: { moduleId: 'it', entityType: 'catalogItem', entityId: String(type._id) },
      action: 'create',
      changes: [
        ...diffChanges(
          {},
          {
            kind: type.kind,
            code: type.code,
            name: type.name,
            description: type.description,
            sortOrder: type.sortOrder,
            isActive: type.isActive,
          },
        ),
        { field: 'source', old: null, new: IT_CONSUMABLE_TYPES_MARK },
      ],
    });
  }
  return { status: 'done', ...run.outcome };
};

/** Run it once and say what happened. Exported so a test can await it. */
export const runItConsumableTypesGoLive = async (): Promise<void> => {
  const outcome = await seedItConsumableTypes();
  if (outcome.status === 'done') {
    logger.warn(outcome, 'it go-live: the consumable types were seeded — done, and never again');
  }
};

/** This process's run of the step, once started — what the opening stock waits on (see below). */
let seeding: Promise<void> | null = null;

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — the inventory's terms.
 */
export const startItConsumableTypesGoLive = (): void => {
  if (isTest) return;
  seeding = runItConsumableTypesGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'it go-live: seeding the consumable types failed — no boot was harmed',
    );
  });
};

/**
 * Settles once this process's seeding has — done, already done or failed — and at once when it was
 * never started. The opening stock is started beside it in the same boot and refuses until the
 * types' run row is there; without this wait the first boot would race the two, and could refuse
 * the stock merely for having asked first — and then hold it back until the NEXT deploy.
 */
export const itConsumableTypesSettled = (): Promise<void> => seeding ?? Promise.resolve();
