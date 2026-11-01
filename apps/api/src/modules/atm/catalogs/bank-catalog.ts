// Reading the bank catalog (DEC-35) — the one place a bank code, a bank's name and "which bank does
// this Operations text mean" are answered on the server.
//
// ONE lean find of every bank per request (the catalog holds a handful — fewer than 50 — rows), and
// NO cache: several API instances must agree the moment a bank is added, renamed or archived, and a
// per-process cache would let one instance accept a code another has just archived.
//
// Resolving a machine's bank text (`resolveBankOfLabel`) goes, in this order:
//   1. a catalog key — the bank's current `opsLabel` or any former one, trimmed and upper-cased;
//   2. the branch's live, ACTIVE Operations spelling with exactly that name and a mapped
//      `bankCode` (`NBE FOREX` → NBE — DEC-16 keeps it a per-branch spelling, never a company-wide
//      alias);
//   3. otherwise no bank.
// The catalog answers first because its keys are unique company-wide (`ux_bank_ops_label_keys`)
// and the bank service refuses a label a mapped spelling already holds, so the two can never
// disagree about one text.
import { Types, type ClientSession } from 'mongoose';
import {
  atmBankLabelKey,
  atmBankSeedOf,
  isAtmSeedBankCode,
  type AtmBankCode,
  type LocalizedString,
} from '@ecms/contracts';
import { AtmRefLabelModel } from './ref-label.model';
import { AtmBankModel, type AtmBankDoc } from './bank.model';

export interface AtmBankCatalog {
  /** Every bank, archived ones included, in `sortOrder` then code. */
  all: readonly AtmBankDoc[];
  /** The banks a picker offers and a new receipt or machine add may use. */
  active: readonly AtmBankDoc[];
  byCode: ReadonlyMap<AtmBankCode, AtmBankDoc>;
  /** Step 1 of the resolution: the bank whose current or former label this is, archived or not. */
  bankOfLabel: (label: string) => AtmBankDoc | null;
  /** The label a receipt writes on the master: the catalog's, else the seed's, else the code. */
  opsLabel: (code: AtmBankCode) => string;
  /** The bank's names: the catalog's, else the seed's; null for a code nobody knows. */
  nameOf: (code: AtmBankCode) => LocalizedString | null;
  /** The non-seed codes in catalog order — what `atmReportBankOrders` appends after the six. */
  extrasInOrder: readonly AtmBankCode[];
}

const byCatalogOrder = (a: AtmBankDoc, b: AtmBankDoc): number =>
  a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);

/** Pure: the catalog's answers over the given rows (the spec builds it from literals). */
export const buildAtmBankCatalog = (docs: readonly AtmBankDoc[]): AtmBankCatalog => {
  const all = [...docs].sort(byCatalogOrder);
  const byCode = new Map(all.map((bank) => [bank.code, bank]));
  const byKey = new Map<string, AtmBankDoc>();
  for (const bank of all) {
    // `opsLabelKeys` is the stored, indexed truth; the fallback covers a row a test or an older
    // writer left without it.
    const keys =
      bank.opsLabelKeys.length > 0
        ? bank.opsLabelKeys
        : [bank.opsLabel, ...bank.formerOpsLabels].map(atmBankLabelKey);
    for (const key of keys) if (!byKey.has(key)) byKey.set(key, bank);
  }
  return {
    all,
    active: all.filter((bank) => bank.isActive),
    byCode,
    bankOfLabel: (label) => byKey.get(atmBankLabelKey(label)) ?? null,
    opsLabel: (code) => byCode.get(code)?.opsLabel ?? atmBankSeedOf(code)?.opsLabel ?? code,
    nameOf: (code) => byCode.get(code)?.name ?? atmBankSeedOf(code)?.name ?? null,
    extrasInOrder: all.filter((bank) => !isAtmSeedBankCode(bank.code)).map((bank) => bank.code),
  };
};

/** The catalog as stored now. Inside a transaction, pass its session so the read is in it. */
export const loadAtmBankCatalog = async (session?: ClientSession): Promise<AtmBankCatalog> =>
  buildAtmBankCatalog(
    await AtmBankModel.find({ isDeleted: false })
      .session(session ?? null)
      .lean<AtmBankDoc[]>()
      .exec(),
  );

/** One branch spelling as the resolution reads it. */
export interface AtmBankSpelling {
  name: string;
  bankCode: string | null;
}

/**
 * Pure: steps 1–3 over spellings already read. `spellings` are the branch's live, ACTIVE bank
 * labels; one counts only under its EXACT stored name (the import's `NBE FOREX` rule, DEC-16) and
 * only when mapped to a bank the catalog knows. An archived bank is returned as it is — refusing it
 * (`INACTIVE`) is the caller's decision, because only the caller knows whether it is a new write.
 */
export const pickBankOfLabel = (
  label: string,
  catalog: Pick<AtmBankCatalog, 'bankOfLabel' | 'byCode'>,
  spellings: readonly AtmBankSpelling[],
): AtmBankDoc | null => {
  const keyed = catalog.bankOfLabel(label);
  if (keyed !== null) return keyed;
  const code = spellings.find((row) => row.name === label && row.bankCode !== null)?.bankCode;
  return code === undefined || code === null ? null : (catalog.byCode.get(code) ?? null);
};

/** Steps 1–3 for one branch: the catalog first, then that branch's spelling. */
export const resolveBankOfLabel = async (
  branchId: Types.ObjectId | string,
  label: string,
  catalog: AtmBankCatalog,
  session?: ClientSession,
): Promise<AtmBankDoc | null> => {
  const keyed = catalog.bankOfLabel(label);
  if (keyed !== null) return keyed;
  const spellings = await AtmRefLabelModel.find(
    {
      branchId: new Types.ObjectId(String(branchId)),
      kind: 'bank',
      name: label,
      isActive: true,
      isDeleted: false,
      bankCode: { $ne: null },
    },
    { name: 1, bankCode: 1 },
  )
    .session(session ?? null)
    .lean<AtmBankSpelling[]>()
    .exec();
  return pickBankOfLabel(label, catalog, spellings);
};
