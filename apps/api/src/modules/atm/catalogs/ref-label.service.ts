// Add / remove for the two label lists — the checkment2/3 (add) and checkment8/9 (remove)
// branches of the legacy /data_edit_atm POST (contad_app.js:2471-2527). Configuration, not
// domain facts: audited, no events (the operations bank precedent).
//
// Add and edit are Operations' own keys (`atmRefLabel.create` / `.edit`) beside `atmMachine.manage`
// (D2); remove stays `manage`. A label is filed in ONE branch, and a bank label there drives what
// the register adopts (D5, DEC-16 — `NBE FOREX`), so the authorizing key must reach THAT branch
// (DEC-29, review finding F-4): the caller's acting branch alone is chosen from the union reach of
// all their grants, which an unrelated key could stretch to a branch this key never covers.
//
// Since the bank catalog (DEC-35, DEC-38):
//   · a `bank` row is an Operations SPELLING of a catalog bank and names it (`bankCode`, an ACTIVE
//     bank). A text a catalog bank already answers to (its label, current or former) is no spelling
//     at all — catalog keys resolve first — so it is refused (409 `ATM_BANK_LABEL_TAKEN`): for
//     another bank it would be ambiguous, for its own bank redundant;
//   · an `area` row from the dialog carries both names, and the ENGLISH one is what machines store
//     (the owner: «الإنجليزي تمام» — stored areas are Latin, MOHNDESSEN, ALEX, and the import's
//     ` FX` rule needs Latin). A legacy `{ name }` still works; its display name follows its script;
//   · Efficiency add AREAS with the register keys they already hold (`atmRegister.create` / `.edit`
//     reaching the branch) — the register form's «+ منطقة»; never a bank spelling;
//   · a rename keeps the old area name in `formerNames`, so no automatic label brings it back.
import { Types, type FilterQuery } from 'mongoose';
import {
  ErrorCodes,
  type AtmBankCode,
  type AtmRefLabelOptionsDto,
  type AtmRefLabelOptionsQuery,
  type CreateAtmRefLabel,
  type ListAtmRefLabelsQuery,
  type Paginated,
  type UpdateAtmRefLabel,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { branchRepository } from '../../../platform/organization';
import {
  hasPermission,
  keyReachesBranch,
  scopeSelector,
  type AuthContext,
} from '../../../shared/types';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { BaseRepository } from '../../../shared/base/base.repository';
import { toAtmRefLabelDto } from '../atm.mappers';
import { assertNoBranchMoveRunning } from '../branch-links/move-fence';
import { AtmMachineModel } from '../machines/machine.model';
import { resolveRegisterSettings } from '../register/register-settings';
import {
  actingAtmBranchId,
  manageActsInBranch,
  resolveAtmBranchId,
  resolveLinkedBranchId,
} from '../shared/atm-context';
import { areaNamesByScript } from './area-labels';
import {
  loadAtmBankCatalog,
  pickBankOfLabel,
  type AtmBankCatalog,
  type AtmBankSpelling,
} from './bank-catalog';
import { bankCodeOfSpelling } from './catalog.migration';
import { AtmRefLabelModel, type AtmRefLabelDoc, type AtmRefLabelKind } from './ref-label.model';

class AtmRefLabelRepository extends BaseRepository<AtmRefLabelDoc> {
  constructor() {
    super(AtmRefLabelModel, { branchField: 'branchId' });
  }
}

export const atmRefLabelRepository = new AtmRefLabelRepository();

const entityRef = (id: string) => ({ moduleId: 'atm', entityType: 'refLabel', entityId: id });

/** The keys that open the options read (the data-edit page's whole audience). */
export const ATM_REF_LABEL_OPTIONS_KEYS = [
  'atmMachine.view',
  'atmMachine.manage',
  'atmMachine.moveArea',
  'atmRefLabel.create',
  'atmRefLabel.edit',
] as const;

/**
 * The key a label write with no branch named is filed by (GM-20, atm-context.ts — "the write's own
 * key"): `manage` first — the add-machine dialogs file by it, and share the label tabs' options
 * answer — else the label key the caller holds. The Operations roles hold `atmRefLabel.*` without
 * `manage` (atm-efficiency-register.md §12.2 step 3): judged on `manage` alone, such a holder
 * company-wide was never organization-wide, so a label added on «المهندسين» was filed at their
 * home placement, and on «كل الشركة» silently too.
 */
const heldKeyOf = (ctx: AuthContext, keys: readonly [string, ...string[]]): string =>
  keys.find((key) => ctx.permissions[key] !== undefined) ?? keys[0];

/** The most machine bank texts the unmapped callout lists. */
const UNMAPPED_BANK_NAMES_MAX = 100;

/** The options while there is no branch to file under: nothing offered, nothing recordable. */
const noBranchOptions = (): AtmRefLabelOptionsDto => ({
  branchId: null,
  branch: null,
  registerMapped: false,
  banks: [],
  areas: [],
  unmappedBankNames: [],
  unmappedBankLabels: [],
});

const refuse = (field: string, code: string, message: string): ValidationError =>
  new ValidationError([{ field, code, message }]);

const labelTaken = (): ConflictError =>
  new ConflictError(
    'a catalog bank already answers to this text — it needs no Operations spelling',
    ErrorCodes.ATM_BANK_LABEL_TAKEN,
  );

/** A spelling's bank as input: it must be a catalog bank, and an ACTIVE one. */
const assertActiveBank = (code: AtmBankCode, catalog: AtmBankCatalog): void => {
  const bank = catalog.byCode.get(code);
  if (bank === undefined) {
    throw refuse('body.bankCode', 'UNKNOWN', 'not a bank of the bank catalog');
  }
  if (!bank.isActive) throw refuse('body.bankCode', 'INACTIVE', 'this bank is archived');
};

/**
 * Pure: the former names after an area is renamed to `next` — the old name appended (machines keep
 * the text they were given, and no automatic label may re-create it), the current one never listed.
 */
export const nextFormerNames = (
  before: { name: string; formerNames?: readonly string[] | undefined },
  next: string,
): string[] =>
  [...new Set([...(before.formerNames ?? []), before.name])].filter((name) => name !== next);

/** The label row as the options and the register's branch options read it. */
export interface BranchLabelRow {
  kind: string;
  name: string;
  nameAr?: string | null;
  nameEn?: string | null;
  bankCode?: string | null;
}

/** One branch's live, ACTIVE labels of both kinds — one read. */
export const readBranchLabels = async (branchId: string): Promise<BranchLabelRow[]> =>
  AtmRefLabelModel.find(
    { branchId: new Types.ObjectId(branchId), isActive: true, isDeleted: false },
    { kind: 1, name: 1, nameAr: 1, nameEn: 1, bankCode: 1 },
  )
    .lean<BranchLabelRow[]>()
    .exec();

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/**
 * Pure: what a picker offers in one branch — shared by the data-edit options and the register's
 * branch options, so the two forms never disagree.
 *
 * · banks — every ACTIVE catalog bank (its `opsLabel`, what a machine stores), then the branch's
 *   spellings mapped to an ACTIVE bank. A spelling that IS a catalog key (a legacy `NBE` row) is no
 *   override at all and is not offered; an unmapped one has no bank to group under.
 * · areas — the branch's active area labels, with their display names.
 */
export const branchLabelChoices = (
  labels: readonly BranchLabelRow[],
  catalog: Pick<AtmBankCatalog, 'active' | 'byCode' | 'bankOfLabel'>,
): Pick<AtmRefLabelOptionsDto, 'banks' | 'areas'> => {
  const spellings = labels
    .filter((label) => label.kind === 'bank')
    .flatMap((label) => {
      const code = label.bankCode ?? null;
      const bank = code === null ? undefined : catalog.byCode.get(code);
      return bank === undefined || !bank.isActive || catalog.bankOfLabel(label.name) !== null
        ? []
        : [{ name: label.name, bankCode: bank.code }];
    })
    .sort(byName);
  return {
    banks: [
      ...catalog.active.map((bank) => ({
        value: bank.opsLabel,
        bankCode: bank.code,
        kind: 'bank' as const,
      })),
      ...spellings.map((spelling) => ({
        value: spelling.name,
        bankCode: spelling.bankCode,
        kind: 'spelling' as const,
      })),
    ],
    areas: labels
      .filter((label) => label.kind === 'area')
      .sort(byName)
      .map((label) => ({
        name: label.name,
        nameAr: label.nameAr ?? null,
        nameEn: label.nameEn ?? null,
      })),
  };
};

/** The bank fields a NEW spelling is stored with. */
const spellingFields = (
  input: CreateAtmRefLabel,
  catalog: AtmBankCatalog,
): { name: string; nameAr: null; nameEn: null; bankCode: AtmBankCode | null } => {
  const name = input.name;
  if (name === undefined) {
    throw refuse('body.name', 'REQUIRED', 'a bank spelling is the text Operations write');
  }
  if (input.nameAr !== undefined || input.nameEn !== undefined) {
    throw refuse('body.nameAr', 'NOT_ALLOWED', 'a bank spelling has no display names');
  }
  if (input.bankCode !== undefined) assertActiveBank(input.bankCode, catalog);
  if (catalog.bankOfLabel(name) !== null) throw labelTaken();
  // An older screen sends `{ name }` alone: the bank the boot backfill would have given it — a
  // catalog key is already refused above, so `NBE FOREX` (DEC-16) or the import's alias, else none.
  return {
    name,
    nameAr: null,
    nameEn: null,
    bankCode: input.bankCode ?? bankCodeOfSpelling(name, catalog),
  };
};

/** The fields a NEW area is stored with: the English name stored, both shown. */
const areaFields = (
  input: CreateAtmRefLabel,
): { name: string; nameAr: string | null; nameEn: string | null; bankCode: null } => {
  if (input.bankCode !== undefined) {
    throw refuse('body.bankCode', 'NOT_ALLOWED', 'an area has no bank');
  }
  // The schema guarantees `name`, or both display names.
  const name = input.name ?? input.nameEn ?? '';
  const byScript = areaNamesByScript(name);
  return {
    name,
    nameAr: input.nameAr ?? byScript.nameAr,
    nameEn: input.nameEn ?? byScript.nameEn,
    bankCode: null,
  };
};

const auditFields = (doc: Partial<AtmRefLabelDoc>): Record<string, unknown> => ({
  name: doc.name,
  nameAr: doc.nameAr ?? null,
  nameEn: doc.nameEn ?? null,
  formerNames: doc.formerNames ?? [],
  bankCode: doc.bankCode ?? null,
  isActive: doc.isActive,
});

class AtmRefLabelService {
  async list(
    kind: AtmRefLabelKind,
    query: ListAtmRefLabelsQuery,
    ctx: AuthContext,
  ): Promise<Paginated<AtmRefLabelDoc>> {
    const filter: FilterQuery<AtmRefLabelDoc> = { kind };
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    // A user who reaches several branches no longer sees their lists mixed (critic gap 2).
    if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
    return atmRefLabelRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['name', 'createdAt'],
      scope: scopeSelector(ctx, 'atmMachine.view'),
    });
  }

  /**
   * GET /atm/ref-labels/options — what the data-edit dialogs offer for ONE branch, whole: no page
   * cap (the 100-row list read cut long lists short), no other branch's labels, and readable by the
   * page's whole audience — a holder of the label keys alone was refused the `atmMachine.view` list.
   * One of the page's keys must reach the branch (or `manage` at home, as for the add).
   *
   * The branch: the one asked for (an edit's machine's own), read as ATM files it
   * (`atm.branchLinks` — a linked source answers its target's lists); else the branch the add
   * dialogs file their machines in, by the ATM write rule (atm-context.ts) under the write's own
   * key (`heldKeyOf`), named for the top of the add form (`branch`, «الفرع: …»). An
   * organization-wide holder of that key on «كل الشركة» has none while the company has several
   * branches: the lists are empty, `branch` is null and the dialog asks for a branch in the top
   * bar before any add — never their home placement.
   */
  async options(query: AtmRefLabelOptionsQuery, ctx: AuthContext): Promise<AtmRefLabelOptionsDto> {
    const settings = await resolveRegisterSettings();
    const branchId =
      query.branchId === undefined
        ? await actingAtmBranchId(
            ctx,
            heldKeyOf(ctx, ['atmMachine.manage', 'atmRefLabel.create', 'atmRefLabel.edit']),
          )
        : settings.resolveBranch(query.branchId);
    if (branchId === null) return noBranchOptions();
    if (
      !ATM_REF_LABEL_OPTIONS_KEYS.some((key) => keyReachesBranch(ctx, key, branchId)) &&
      !manageActsInBranch(ctx, branchId)
    ) {
      throw new ForbiddenError('no data-edit key reaches this branch');
    }
    const [labels, bankNames, named] = await Promise.all([
      readBranchLabels(branchId),
      AtmMachineModel.distinct('bankName', {
        branchId: new Types.ObjectId(branchId),
        isActive: true,
        isDeleted: false,
      }).exec() as Promise<unknown[]>,
      branchRepository.findByIdsSystem([branchId]),
    ]);
    const branch = named[0];
    // A branch id nobody holds names nothing to file under.
    if (branch === undefined) return noBranchOptions();
    const spellings: AtmBankSpelling[] = labels
      .filter((label) => label.kind === 'bank')
      .map((label) => ({ name: label.name, bankCode: label.bankCode ?? null }));
    const unmappedBankNames = [
      ...new Set(
        bankNames.filter(
          (name): name is string =>
            typeof name === 'string' &&
            name.trim() !== '' &&
            pickBankOfLabel(name, settings.catalog, spellings) === null,
        ),
      ),
    ]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, UNMAPPED_BANK_NAMES_MAX);
    // The row that already holds each text here — ARCHIVED ones too, which `readBranchLabels` leaves
    // out (an archived `NBE FOREX` is exactly why the text reads unmapped). An active, linked
    // spelling never gets here: it would have resolved the text. The page edits this row, so it
    // never depends on the list's page, its status filter or another branch's same-named row.
    const holders =
      unmappedBankNames.length === 0
        ? []
        : await AtmRefLabelModel.find({
            branchId: new Types.ObjectId(branchId),
            kind: 'bank',
            name: { $in: unmappedBankNames },
            isDeleted: false,
          })
            .lean<AtmRefLabelDoc[]>()
            .exec();
    const holderOf = new Map(holders.map((row) => [row.name, row]));
    return {
      branchId,
      branch: { id: branchId, name: { ar: branch.name.ar, en: branch.name.en } },
      registerMapped: settings.isMapped(branchId),
      ...branchLabelChoices(labels, settings.catalog),
      unmappedBankNames,
      unmappedBankLabels: unmappedBankNames.map((name) => {
        const row = holderOf.get(name);
        return { name, label: row === undefined ? null : toAtmRefLabelDto(row) };
      }),
    };
  }

  async create(
    kind: AtmRefLabelKind,
    input: CreateAtmRefLabel,
    ctx: AuthContext,
  ): Promise<AtmRefLabelDoc> {
    await assertNoBranchMoveRunning();
    // A branch the body names is read as ATM files it (`atm.branchLinks`): a label sent for a
    // linked source is its target's, where that branch's machines are offered it.
    const branchId =
      input.branchId === undefined
        ? await resolveAtmBranchId(ctx, heldKeyOf(ctx, ['atmMachine.manage', 'atmRefLabel.create']))
        : await resolveLinkedBranchId(input.branchId);
    // Today's rule — the label key or `manage` reaching the branch, `manage` at home — plus, for an
    // AREA only, the register keys reaching it: Efficiency add areas from the register (DEC-39).
    const allowed =
      keyReachesBranch(ctx, 'atmRefLabel.create', branchId) ||
      manageActsInBranch(ctx, branchId) ||
      (kind === 'area' &&
        (keyReachesBranch(ctx, 'atmRegister.create', branchId) ||
          keyReachesBranch(ctx, 'atmRegister.edit', branchId)));
    if (!allowed) throw new ForbiddenError();
    if (input.branchId !== undefined && (await branchRepository.findById(branchId)) === null) {
      throw refuse('body.branchId', 'UNKNOWN', 'branch not found');
    }
    const fields =
      kind === 'bank' ? spellingFields(input, await loadAtmBankCatalog()) : areaFields(input);
    // The unique index turns the legacy's read-then-push duplicate check (:2473, :2485) into a
    // ConflictError the client renders as "already exists" — same rule, no race.
    const doc = await atmRefLabelRepository.create(
      {
        branchId: new Types.ObjectId(branchId),
        kind,
        ...fields,
        formerNames: [],
        origin: 'manual',
        isActive: true,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, { kind, branchId, origin: 'manual', ...auditFields(doc) }),
    });
    return doc;
  }

  /**
   * Edit a label. Renaming changes what the forms OFFER from here on; it does not rewrite the
   * machines that already stored the old string, because the legacy denormalized both the bank
   * and the area onto each machine (:2443) and a cascade would rewrite history nobody asked to
   * change. An area's old name moves to `formerNames`. `isActive: false` archives — the list stops
   * offering it, the machines keep it. `nameAr` / `nameEn` are an area's display names; `bankCode`
   * maps a spelling to an ACTIVE catalog bank (or, null, un-maps it).
   *
   * Allowed to an `atmRefLabel.edit` holder over the label's whole branch, or to a `manage`
   * holder who finds the label in today's `manage` scope (nothing removed); anything else is a
   * 404. The label repository is branch-only, so a department or section scope alone would widen
   * to the company — reach is asked of the key. The write then goes by id and version.
   */
  async update(id: string, input: UpdateAtmRefLabel, ctx: AuthContext): Promise<AtmRefLabelDoc> {
    await assertNoBranchMoveRunning();
    const before = await atmRefLabelRepository.findById(id);
    if (before === null) throw new NotFoundError('ATM label');
    const allowed =
      keyReachesBranch(ctx, 'atmRefLabel.edit', String(before.branchId)) ||
      (hasPermission(ctx, 'atmMachine.manage') &&
        (await atmRefLabelRepository.findById(id, scopeSelector(ctx, 'atmMachine.manage'))) !==
          null);
    if (!allowed) throw new NotFoundError('ATM label');
    const isBank = before.kind === 'bank';
    const set: Record<string, unknown> = {};

    const renamedTo =
      input.name === undefined || input.name.trim() === before.name ? null : input.name.trim();
    if (renamedTo === '') throw refuse('body.name', 'REQUIRED', 'a label needs a name');
    if (renamedTo !== null) {
      set.name = renamedTo;
      if (!isBank) set.formerNames = nextFormerNames(before, renamedTo);
    }
    if (isBank) {
      // A display name belongs to areas; an unchanged (null) one from a generic form is harmless.
      if ((input.nameAr ?? null) !== null || (input.nameEn ?? null) !== null) {
        throw refuse('body.nameAr', 'NOT_ALLOWED', 'a bank spelling has no display names');
      }
    } else {
      if (input.nameAr !== undefined) set.nameAr = input.nameAr;
      if (input.nameEn !== undefined) set.nameEn = input.nameEn;
      if ((input.bankCode ?? null) !== null) {
        throw refuse('body.bankCode', 'NOT_ALLOWED', 'an area has no bank');
      }
    }
    if (isBank && (renamedTo !== null || input.bankCode !== undefined)) {
      const catalog = await loadAtmBankCatalog();
      if (input.bankCode !== undefined && input.bankCode !== null) {
        assertActiveBank(input.bankCode, catalog);
      }
      const bankCode =
        input.bankCode !== undefined
          ? input.bankCode
          : ((before.bankCode ?? null) as string | null);
      const holder = catalog.bankOfLabel(renamedTo ?? before.name);
      // A NEW text a catalog bank answers to is no spelling (as on create); an existing legacy row
      // that is its own bank's label (`NBE` → NBE) may keep it, but not be moved to another bank.
      if (
        holder !== null &&
        (renamedTo !== null || (bankCode !== null && holder.code !== bankCode))
      ) {
        throw labelTaken();
      }
      if (input.bankCode !== undefined) set.bankCode = input.bankCode;
    }
    if (input.isActive !== undefined) set.isActive = input.isActive;
    const updated = await atmRefLabelRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(auditFields(before), auditFields(updated)),
    });
    return updated;
  }

  /** Legacy `$pull` (:2514, :2523) — the name leaves the list; machines keep their strings. */
  async remove(id: string, ctx: AuthContext): Promise<void> {
    await assertNoBranchMoveRunning();
    const doc = await atmRefLabelRepository.softDeleteById(id, {
      by: ctx.userId,
      scope: scopeSelector(ctx, 'atmMachine.manage'),
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges({ kind: doc.kind, name: doc.name }, {}),
    });
  }
}

export const atmRefLabelService = new AtmRefLabelService();
