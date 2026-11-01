// Boot steps of the bank catalog (DEC-35) — automatic, idempotent, safe on every boot (the
// machine.migration.ts precedent): a second boot writes nothing, and the logs carry counts and bank
// codes only, never a label.
//
// 1. `seedAtmBankCatalog` — the workbook's six into `atm_banks`. Each seed's label is the one the
//    retired `atm.register.bankLabels` setting held (an administrator's curated label survives the
//    move), else its D5 default. The setting allowed two banks one label (its schema makes only
//    `bankCode` unique), which the catalog's unique `ux_bank_ops_label_keys` refuses — so the pure
//    planner removes every collision BEFORE any write, and the boot also catches an E11000 (two
//    instances booting at once) and logs it: the boot never fails on the catalog. Written with
//    `$setOnInsert` only, so a bank curated after the first boot is never overwritten, and the
//    setting is read only while a seed is still missing — after that, never again.
//
// 2. `backfillBankLabelCodes` — every per-branch Operations spelling (`atm_ref_labels` kind `bank`)
//    written before spellings carried a `bankCode` gets one: a catalog key → that bank, `NBE FOREX`
//    → NBE (DEC-16), the import's one alias `نيكست` → NXT, anything else → null (unmapped, shown to
//    Operations to map). Guarded by `bankCode: { $exists: false }`, so it runs once per row — rows
//    `npm run atm:import` writes later are picked up at the next boot.
import { type Types } from 'mongoose';
import {
  ATM_BANK_SEED,
  ATM_NBE_FOREX_LABEL,
  ATM_REGISTER_BANK_ALIASES,
  AtmSettingKeys,
  atmBankLabelKey,
  type AtmBankCode,
  type AtmRegisterBankLabelsSetting,
  type AtmSeedBankCode,
} from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { settingsService } from '../../../platform/settings';
import { loadAtmBankCatalog, type AtmBankCatalog } from './bank-catalog';
import { AtmBankModel } from './bank.model';
import { AtmRefLabelModel } from './ref-label.model';

const ORG_SUBJECT = { userId: null, branchId: null };

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

export interface BankSeedPlanRow {
  code: AtmSeedBankCode;
  opsLabel: string;
  /**
   * The D5 default, when the stored setting replaced it. Machines created before the override —
   * every legacy machine, every receipt made before the administrator changed the setting — carry
   * the default text, and must keep resolving to their bank.
   */
  formerOpsLabels: string[];
}

export interface BankSeedPlan {
  rows: BankSeedPlanRow[];
  /** Seeds whose stored label collided and went back to the default (logged by code only). */
  reverted: AtmSeedBankCode[];
}

/**
 * Pure: each seed's label from the stored setting, with every collision removed.
 *
 * A bank holds its candidate label and, when the setting overrode it, its default as a former
 * label. ONE rule, repeated until nothing changes: an OVERRIDE whose key (trim + upper-case) equals
 * a key another bank holds goes back to its own default. The six defaults are distinct and every
 * bank always holds its own, so a reverted bank can collide with no one, and the loop ends within
 * six passes with no duplicate key left.
 */
export const planBankSeed = (stored: AtmRegisterBankLabelsSetting): BankSeedPlan => {
  const override = new Map<AtmSeedBankCode, string>();
  for (const seed of ATM_BANK_SEED) {
    const label = stored.find((row) => row.bankCode === seed.code)?.label.trim();
    if (label !== undefined && atmBankLabelKey(label) !== atmBankLabelKey(seed.opsLabel)) {
      override.set(seed.code, label);
    }
  }
  const keysOf = (seed: (typeof ATM_BANK_SEED)[number]): string[] => {
    const label = override.get(seed.code);
    return label === undefined
      ? [atmBankLabelKey(seed.opsLabel)]
      : [atmBankLabelKey(label), atmBankLabelKey(seed.opsLabel)];
  };
  const reverted: AtmSeedBankCode[] = [];
  // Each pass judges every override against the SAME state and reverts them together: reverting
  // one of two equal overrides first would leave the other looking unique, and keep a label two
  // banks were given — which of them meant it is not this planner's guess to make.
  for (;;) {
    const colliding = ATM_BANK_SEED.filter((seed) => {
      const label = override.get(seed.code);
      if (label === undefined) return false;
      const key = atmBankLabelKey(label);
      return ATM_BANK_SEED.some((other) => other.code !== seed.code && keysOf(other).includes(key));
    });
    if (colliding.length === 0) break;
    for (const seed of colliding) {
      override.delete(seed.code);
      reverted.push(seed.code);
    }
  }
  return {
    rows: ATM_BANK_SEED.map((seed) => {
      const label = override.get(seed.code);
      return label === undefined
        ? { code: seed.code, opsLabel: seed.opsLabel, formerOpsLabels: [] }
        : { code: seed.code, opsLabel: label, formerOpsLabels: [seed.opsLabel] };
    }),
    reverted,
  };
};

export interface BankSeedResult {
  inserted: number;
  reverted: AtmSeedBankCode[];
  /** Seeds an E11000 stopped (a concurrent boot, or a label a curated bank took meanwhile). */
  skipped: AtmSeedBankCode[];
}

/** Boot step: the six into `atm_banks` — inserted once, never overwritten. */
export const seedAtmBankCatalog = async (): Promise<BankSeedResult> => {
  const present = new Set(
    (await AtmBankModel.collection.distinct('code', {
      code: { $in: ATM_BANK_SEED.map((seed) => seed.code) },
    })) as unknown[],
  );
  const missing = ATM_BANK_SEED.filter((seed) => !present.has(seed.code));
  const result: BankSeedResult = { inserted: 0, reverted: [], skipped: [] };
  if (missing.length === 0) return result;

  // Read ONCE, and only while a seed is still to be inserted (DEC-35: the setting is retired).
  const stored = await settingsService.resolve<AtmRegisterBankLabelsSetting>(
    AtmSettingKeys.RegisterBankLabels,
    ORG_SUBJECT,
  );
  const plan = planBankSeed(stored);
  result.reverted = plan.reverted;
  if (plan.reverted.length > 0) {
    logger.warn(
      { codes: plan.reverted },
      'atm: a stored bank label collided with another bank’s — the default label was seeded instead',
    );
  }

  const now = new Date();
  for (const seed of missing) {
    const row = plan.rows.find((candidate) => candidate.code === seed.code);
    const opsLabel = row?.opsLabel ?? seed.opsLabel;
    const formerOpsLabels = row?.formerOpsLabels ?? [];
    try {
      const write = await AtmBankModel.collection.updateOne(
        { code: seed.code },
        {
          $setOnInsert: {
            code: seed.code,
            name: { ar: seed.name.ar, en: seed.name.en },
            opsLabel,
            formerOpsLabels,
            opsLabelKeys: [...new Set([opsLabel, ...formerOpsLabels].map(atmBankLabelKey))],
            color: seed.color,
            sortOrder: seed.sortOrder,
            isActive: true,
            isSeed: true,
            // The raw driver stamps nothing: the base fields are written out, as Mongoose would.
            schemaVersion: 1,
            isDeleted: false,
            deletedAt: null,
            deletedBy: null,
            createdBy: null,
            updatedBy: null,
            __v: 0,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
      result.inserted += write.upsertedCount;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      result.skipped.push(seed.code);
      logger.warn({ code: seed.code }, 'atm: bank seed not inserted (duplicate key) — skipped');
    }
  }
  if (result.inserted > 0) {
    logger.info({ inserted: result.inserted }, 'atm: bank catalog seeded with the workbook banks');
  }
  return result;
};

/**
 * Pure: the bank an existing spelling stands for — a catalog key, `NBE FOREX` (DEC-16), the
 * import's alias, else none. Never a guess: an unmapped spelling stays null for Operations to map.
 */
export const bankCodeOfSpelling = (
  name: string,
  catalog: Pick<AtmBankCatalog, 'bankOfLabel'>,
): AtmBankCode | null => {
  const keyed = catalog.bankOfLabel(name);
  if (keyed !== null) return keyed.code;
  if (atmBankLabelKey(name) === atmBankLabelKey(ATM_NBE_FOREX_LABEL)) return 'NBE';
  return ATM_REGISTER_BANK_ALIASES[name.trim()] ?? null;
};

export interface BankLabelBackfillResult {
  mapped: number;
  unmapped: number;
}

/** Boot step: a `bankCode` on every spelling written before spellings carried one. */
export const backfillBankLabelCodes = async (
  known?: AtmBankCatalog,
): Promise<BankLabelBackfillResult> => {
  const rows = await AtmRefLabelModel.collection
    .find<{ _id: Types.ObjectId; name?: unknown }>(
      { kind: 'bank', bankCode: { $exists: false } },
      { projection: { name: 1 } },
    )
    .toArray();
  const result: BankLabelBackfillResult = { mapped: 0, unmapped: 0 };
  if (rows.length === 0) return result;
  const catalog = known ?? (await loadAtmBankCatalog());
  const writes: Parameters<typeof AtmRefLabelModel.collection.bulkWrite>[0] = rows.map((row) => {
    const bankCode = typeof row.name === 'string' ? bankCodeOfSpelling(row.name, catalog) : null;
    if (bankCode === null) result.unmapped += 1;
    else result.mapped += 1;
    return {
      updateOne: {
        filter: { _id: row._id, bankCode: { $exists: false } },
        update: { $set: { bankCode } },
      },
    };
  });
  await AtmRefLabelModel.collection.bulkWrite(writes, { ordered: false });
  logger.info(result, 'atm: Operations bank spellings given their catalog bank');
  return result;
};
