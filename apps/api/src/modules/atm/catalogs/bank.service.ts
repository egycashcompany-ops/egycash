// The bank catalog's writes (DEC-35) — GET/POST /atm/banks, PATCH /atm/banks/:code.
//
// A bank is ONE fact about the company, so both writes need their key at ORGANIZATION scope
// (`atmBank.create` / `atmBank.edit`): a branch-scoped holder adding a bank would be adding it for
// every branch. Configuration, not domain events: audited as `atm.bank` `create` / `update`, which
// is also what refreshes open screens (realtime registry).
//
// Three refusals, each its own code (409), because each would otherwise change what stored data
// means:
//   · `ATM_BANK_CODE_TAKEN` — a code is the key on entries, plans and URLs; it is never reused;
//   · `ATM_BANK_LABEL_TAKEN` — the label key is another bank's current or former label, or a live
//     branch spelling mapped to another bank. Catalog keys resolve FIRST (`bank-catalog.ts`), so
//     taking a spelling's text would silently move that branch's machines to the new bank;
//   · `ATM_BANK_NAME_TAKEN` — two banks named alike in either language could not be told apart on
//     the register, the report or the map.
// Nothing is deleted: `isActive: false` archives — the bank is no longer offered for new receipts or
// machine adds, and stays named and counted wherever it is already stored.
import {
  ATM_BANK_EXTRA_COLORS,
  ErrorCodes,
  atmBankLabelKey,
  isAtmSeedBankCode,
  type CreateAtmBank,
  type EntityRef,
  type LocalizedString,
  type UpdateAtmBank,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleDocumentError,
} from '../../../shared/errors';
import { scopeOf, type AuthContext } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { AtmBankModel, type AtmBankDoc } from './bank.model';
import { AtmRefLabelModel } from './ref-label.model';

class AtmBankRepository extends BaseRepository<AtmBankDoc> {
  constructor() {
    // Company-wide: no branch field, so every read is the whole catalog.
    super(AtmBankModel);
  }
}

export const atmBankRepository = new AtmBankRepository();

/** The audit entity — a LITERAL pair, so the realtime registry spec can find it. */
const bankRef = (id: string): EntityRef => ({ moduleId: 'atm', entityType: 'bank', entityId: id });

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** How two names are compared: trimmed, case ignored (Latin names; Arabic has no case). */
const nameKey = (name: string): string => name.trim().toLocaleLowerCase('en');

/**
 * The label keys a bank holds: its current label first, then each former one — distinct, so a label
 * changed and changed back is held once. Pure.
 */
export const bankLabelKeys = (opsLabel: string, formerOpsLabels: readonly string[]): string[] => [
  ...new Set([opsLabel, ...formerOpsLabels].map(atmBankLabelKey)),
];

/**
 * Pure: the former labels after `opsLabel` changes to `next` — the old label appended (machines
 * keep the text they were given, so it must keep resolving), and any label whose key `next` now
 * holds dropped, so the list never repeats the current one.
 */
export const nextFormerOpsLabels = (
  current: { opsLabel: string; formerOpsLabels: readonly string[] },
  next: string,
): string[] => {
  const nextKey = atmBankLabelKey(next);
  const seen = new Set<string>([nextKey]);
  const out: string[] = [];
  for (const label of [...current.formerOpsLabels, current.opsLabel]) {
    const key = atmBankLabelKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
};

/** Pure: the colour a new bank gets — the first extra no bank wears, else the least worn one. */
export const defaultBankColor = (usedColors: readonly string[]): string => {
  const uses = new Map<string, number>(ATM_BANK_EXTRA_COLORS.map((color) => [color, 0]));
  for (const color of usedColors) {
    const key = color.toUpperCase();
    const n = uses.get(key);
    if (n !== undefined) uses.set(key, n + 1);
  }
  let best = ATM_BANK_EXTRA_COLORS[0] ?? '#7030A0';
  let bestUses = Number.POSITIVE_INFINITY;
  for (const [color, n] of uses) {
    if (n < bestUses) {
      best = color;
      bestUses = n;
    }
  }
  return best;
};

const snapshot = (doc: AtmBankDoc): Record<string, unknown> => ({
  code: doc.code,
  'name.ar': doc.name.ar,
  'name.en': doc.name.en,
  opsLabel: doc.opsLabel,
  formerOpsLabels: doc.formerOpsLabels,
  color: doc.color,
  sortOrder: doc.sortOrder,
  isActive: doc.isActive,
});

const labelTaken = (): ConflictError =>
  new ConflictError(
    'this Operations label is already another bank’s, or a branch spelling of another bank',
    ErrorCodes.ATM_BANK_LABEL_TAKEN,
  );

class AtmBankService {
  /** GET /atm/banks — every bank, archived ones included, in catalog order. */
  async list(): Promise<AtmBankDoc[]> {
    const banks = await AtmBankModel.find({ isDeleted: false }).lean<AtmBankDoc[]>().exec();
    return banks.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  }

  /** A bank is one fact about the company: the key must be held company-wide. */
  private assertOrganizationScope(ctx: AuthContext, key: 'atmBank.create' | 'atmBank.edit'): void {
    if (scopeOf(ctx, key) !== 'organization') {
      throw new ForbiddenError(
        `${key} must be held at organization scope — a bank is company-wide`,
      );
    }
  }

  /** 409 unless no OTHER bank, and no live spelling mapped to another bank, holds one of `keys`. */
  private async assertLabelsFree(keys: readonly string[], ownCode: string | null): Promise<void> {
    const holder = await AtmBankModel.exists({
      isDeleted: false,
      opsLabelKeys: { $in: [...keys] },
      ...(ownCode === null ? {} : { code: { $ne: ownCode } }),
    }).exec();
    if (holder !== null) throw labelTaken();
    // Archived spellings count too: their machines still carry the text and still mean that bank.
    const spellings = (await AtmRefLabelModel.distinct('name', {
      kind: 'bank',
      isDeleted: false,
      bankCode: { $nin: ownCode === null ? [null] : [null, ownCode] },
    }).exec()) as unknown[];
    const wanted = new Set(keys);
    if (spellings.some((name) => typeof name === 'string' && wanted.has(atmBankLabelKey(name)))) {
      throw labelTaken();
    }
  }

  /** 409 when another bank already has this Arabic or this English name. */
  private async assertNameFree(name: LocalizedString, ownCode: string | null): Promise<void> {
    const others = await AtmBankModel.find(
      { isDeleted: false, ...(ownCode === null ? {} : { code: { $ne: ownCode } }) },
      { name: 1 },
    )
      .lean<Pick<AtmBankDoc, 'name'>[]>()
      .exec();
    const ar = nameKey(name.ar);
    const en = nameKey(name.en);
    if (others.some((bank) => nameKey(bank.name.ar) === ar || nameKey(bank.name.en) === en)) {
      throw new ConflictError(
        'another bank already has this Arabic or English name',
        ErrorCodes.ATM_BANK_NAME_TAKEN,
      );
    }
  }

  /** POST /atm/banks. The colour and the order default to the next free ones. */
  async create(input: CreateAtmBank, ctx: AuthContext): Promise<AtmBankDoc> {
    this.assertOrganizationScope(ctx, 'atmBank.create');
    const codeTaken = async (): Promise<boolean> =>
      (await AtmBankModel.exists({ code: input.code }).exec()) !== null;
    if (await codeTaken()) {
      throw new ConflictError('a bank already has this code', ErrorCodes.ATM_BANK_CODE_TAKEN);
    }
    const keys = bankLabelKeys(input.opsLabel, []);
    await this.assertLabelsFree(keys, null);
    await this.assertNameFree(input.name, null);

    const existing = await AtmBankModel.find({ isDeleted: false }, { color: 1, sortOrder: 1 })
      .lean<Pick<AtmBankDoc, 'color' | 'sortOrder'>[]>()
      .exec();
    let doc: AtmBankDoc;
    try {
      doc = await atmBankRepository.create(
        {
          code: input.code,
          name: { ar: input.name.ar, en: input.name.en },
          opsLabel: input.opsLabel,
          formerOpsLabels: [],
          opsLabelKeys: keys,
          color: input.color ?? defaultBankColor(existing.map((bank) => bank.color)),
          sortOrder: input.sortOrder ?? Math.max(0, ...existing.map((bank) => bank.sortOrder)) + 10,
          isActive: true,
          // A code the workbook knows was seeded at boot and is taken above; a new bank never is one.
          isSeed: isAtmSeedBankCode(input.code),
        },
        { by: ctx.userId },
      );
    } catch (error) {
      // The two unique indexes are the race-proof half of the checks above.
      if (error instanceof ConflictError) {
        if (await codeTaken()) {
          throw new ConflictError('a bank already has this code', ErrorCodes.ATM_BANK_CODE_TAKEN);
        }
        throw labelTaken();
      }
      throw error;
    }
    await auditService.record({
      entityRef: bankRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  /**
   * PATCH /atm/banks/:code — versioned. A new `opsLabel` moves the old one to `formerOpsLabels`
   * (machines keep the text they carry, and it must keep resolving to this bank); the keys are
   * recomputed and checked again. Archiving and un-archiving are always allowed.
   */
  async update(code: string, input: UpdateAtmBank, ctx: AuthContext): Promise<AtmBankDoc> {
    this.assertOrganizationScope(ctx, 'atmBank.edit');
    const before = await atmBankRepository.findOne({ code });
    if (before === null) throw new NotFoundError('ATM bank');
    if (before.__v !== input.version) throw new StaleDocumentError();

    const set: Record<string, unknown> = {};
    if (input.name !== undefined) {
      await this.assertNameFree(input.name, code);
      set.name = { ar: input.name.ar, en: input.name.en };
    }
    if (input.opsLabel !== undefined && input.opsLabel !== before.opsLabel) {
      const formerOpsLabels = nextFormerOpsLabels(before, input.opsLabel);
      const keys = bankLabelKeys(input.opsLabel, formerOpsLabels);
      await this.assertLabelsFree(keys, code);
      set.opsLabel = input.opsLabel;
      set.formerOpsLabels = formerOpsLabels;
      set.opsLabelKeys = keys;
    }
    if (input.color !== undefined) set.color = input.color;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) set.isActive = input.isActive;

    let updated: AtmBankDoc;
    try {
      updated = await atmBankRepository.updateById(String(before._id), set, {
        by: ctx.userId,
        version: input.version,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw labelTaken();
      throw error;
    }
    await auditService.record({
      entityRef: bankRef(String(updated._id)),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const atmBankService = new AtmBankService();
