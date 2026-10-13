// The register's behaviour (spec §5.6): Receive, Edit, Receive-a-pending-entry, Handover, Delete,
// Reveal and Link — every write ONE `unitOfWork` with the master coupling inside it, and its audit
// rows recorded once, after the transaction resolves (an audit row is a queue write outside the
// session, and `withTransaction` may run its callback more than once).
//
// Authorization is three layers, all of them server-side:
//   1. the route gate (`authorize('atmRegister.<action>')`);
//   2. the READ scope — the entry must be found through `scopeSelector(ctx, <key>)`, narrowed by
//      `registerScopeMatch` (DEC-29), so a row outside the caller's reach is a 404, not a hint;
//   3. the WRITE reach — `keyCoversEntry`: the key is organization-wide or reaches the entry's
//      whole branch. A department-, section- or own-scoped holder reads within their branch and
//      writes nothing (403, which leaks nothing: the row was already readable to them).
// On top of that, writing a K/S field needs `atmRegister.viewSecrets` over the same branch
// (DEC-7, write implies read), and a receipt's branch must be one the create key reaches (D4).
//
// Audit verbs (lead override O-2): a new entry → `create`; pending → open and open → ended →
// `statusChange`, the transition carried in the diff's `status` change; edits and Link → `update`;
// delete → `delete`; the reveal → `secretRevealed` (an audited READ). Every diff goes through
// `redactedDiff`, so no audit row carries a key code, a note or the combination.
import {
  ATM_BANK_CODES,
  ATM_BANK_NAMES,
  ATM_BANK_REPORT_COLORS,
  ATM_REGISTER_BRANCH_CODES,
  ATM_REGISTER_BRANCH_NAMES,
  ATM_REGISTER_SORT_FIELDS,
  ErrorCodes,
  atmRegisterIdFormatOk,
  deriveAtmRegisterStatus,
  normalizeAtmMachineCode,
  type AtmBankCode,
  type AtmRegisterBranchOptionsDto,
  type AtmRegisterEntryDto,
  type AtmRegisterMasterAction,
  type AtmRegisterMetaDto,
  type AtmRegisterRevealDto,
  type AtmRegisterWarning,
  type AtmRegisterWriteResultDto,
  type EntityRef,
  type HandoverAtmRegisterEntry,
  type ListAtmRegisterEntriesQuery,
  type Paginated,
  type ReceiveAtmRegisterEntry,
  type ReceivePendingAtmRegisterEntry,
  type UpdateAtmRegisterEntry,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { branchRepository } from '../../../platform/organization';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  StaleDocumentError,
  ValidationError,
} from '../../../shared/errors';
import { keyReachesBranch, scopeSelector, type AuthContext } from '../../../shared/types';
import { AtmRefLabelModel } from '../catalogs/ref-label.model';
import { AtmMachineModel, type AtmMachineDoc } from '../machines/machine.model';
import { cairoDateString } from '../shared/cairo-time';
import {
  archiveIfLastOpen,
  coupleReceipt,
  isCouplingRefusal,
  isPlaceholderMachineCode,
  linkUncoupled,
  syncEntryToMaster,
  uncoupledPrecondition,
  type CouplingOutcome,
  type CouplingRefusal,
  type PendingAudit,
} from './register-coupling';
import {
  REGISTER_CASSETTE_FIELDS,
  REGISTER_KEY_FIELDS,
  registerDateString,
  toAtmRegisterEntryDto,
  type AtmRegisterLinkedMasterState,
} from './register.mapper';
import { type AtmRegisterEntryDoc } from './register.model';
import { atmRegisterEntryRepository, escapeRegisterRegExp } from './register.repository';
import {
  keyCoversEntry,
  openCombination,
  redactedDiff,
  sealCombination,
  secretsVisibleFor,
} from './register-secrets';
import {
  effectiveOpsLabel,
  resolveRegisterSettings,
  type RegisterSettings,
} from './register-settings';

/** The register's audit entity — a LITERAL pair, so the realtime registry spec can find it. */
const entryRef = (id: string): EntityRef => ({
  moduleId: 'atm',
  entityType: 'registerEntry',
  entityId: id,
});

/** `YYYY-MM-DD` → the UTC-midnight Date the register stores (the HR business-date convention). */
const businessDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

const cairoToday = (): string => cairoDateString(new Date());

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** A sub-document of a raw-inserted row can be missing altogether — read it as all-null. */
const subField = <T extends object>(holder: T | undefined, field: keyof T): unknown =>
  holder?.[field] ?? null;

/**
 * Everything about an entry, flattened one level, for audit diffs. The K/S fields are IN the
 * snapshot (so a change to them is recorded as a fact) and are redacted by `redactedDiff` before
 * anything is written.
 */
export const entrySnapshot = (doc: AtmRegisterEntryDoc): Record<string, unknown> => ({
  branchId: doc.branchId === null ? null : String(doc.branchId),
  area: doc.area,
  bankCode: doc.bankCode,
  opsBankLabel: doc.opsBankLabel,
  machineCode: doc.machineCode,
  machineId: doc.machineId === null ? null : String(doc.machineId),
  name: doc.name,
  operationType: doc.operationType,
  vendor: doc.vendor,
  model: doc.model,
  serial: doc.serial,
  ...Object.fromEntries(
    REGISTER_KEY_FIELDS.map((field) => [`keys.${field}`, subField(doc.keys, field)]),
  ),
  ...Object.fromEntries(
    REGISTER_CASSETTE_FIELDS.map((field) => [`cassettes.${field}`, subField(doc.cassettes, field)]),
  ),
  openTime: doc.openTime,
  closeTime: doc.closeTime,
  accessHoursNotes: doc.accessHoursNotes,
  receiptNotes: doc.receiptNotes,
  safeCombination: doc.safeCombination,
  locationPlusCode: doc.locationPlusCode,
  locationUrl: doc.locationUrl,
  hub: doc.hub,
  startDate: registerDateString(doc.startDate),
  endDate: registerDateString(doc.endDate),
  receivedByName: doc.receivedByName,
  handoverName: doc.handoverName,
  handoverNotes: doc.handoverNotes,
  status: doc.status,
});

/** The P text fields a Receive and an Edit both write as given (§3.7 `commonFields`). */
const PLAIN_TEXT_FIELDS = [
  'operationType',
  'vendor',
  'model',
  'serial',
  'openTime',
  'closeTime',
  'accessHoursNotes',
  'locationPlusCode',
  'locationUrl',
  'hub',
  'receivedByName',
] as const;

/** Does this body write a K or S field (DEC-7)? An empty `keys: {}` writes nothing. */
const writesSecrets = (input: {
  keys?: Record<string, unknown> | undefined;
  receiptNotes?: unknown;
  handoverNotes?: unknown;
  safeCombination?: unknown;
}): boolean =>
  (input.keys !== undefined && Object.values(input.keys).some((value) => value !== undefined)) ||
  input.receiptNotes !== undefined ||
  input.handoverNotes !== undefined ||
  input.safeCombination !== undefined;

const notOpen = (): BusinessRuleError =>
  new BusinessRuleError('the entry is not open', ErrorCodes.ATM_REGISTER_NOT_OPEN);

const recordAll = async (audits: readonly PendingAudit[]): Promise<void> => {
  for (const audit of audits) await auditService.record(audit);
};

export interface AtmRegisterListResult {
  items: AtmRegisterEntryDto[];
  meta: Paginated<unknown>['meta'];
}

class AtmRegisterService {
  // ── Reads ─────────────────────────────────────────────────────────────────────────────────────

  /** The list's filter vocabulary — shared with the CSV export so the two always agree. */
  buildFilter(
    query: Omit<ListAtmRegisterEntriesQuery, 'page' | 'pageSize'>,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
    if (query.banks !== undefined) filter.bankCode = { $in: query.banks };
    if (query.statuses !== undefined) filter.status = { $in: query.statuses };
    if (query.area !== undefined) filter.area = query.area;
    if (query.search !== undefined) {
      // Escaped: a search box is not a regex language (the machine list's unescaped `$regex` is
      // deliberately not copied).
      const pattern = { $regex: escapeRegisterRegExp(query.search), $options: 'i' };
      filter.$or = [{ machineCode: pattern }, { name: pattern }, { serial: pattern }];
    }
    if (query.withIssues === true) filter['importIssues.0'] = { $exists: true };
    return filter;
  }

  async list(query: ListAtmRegisterEntriesQuery, ctx: AuthContext): Promise<AtmRegisterListResult> {
    const sortBy =
      query.sortBy !== undefined &&
      (ATM_REGISTER_SORT_FIELDS as readonly string[]).includes(query.sortBy)
        ? query.sortBy
        : undefined;
    const page = await atmRegisterEntryRepository.list({
      filter: this.buildFilter(query) as FilterQuery<AtmRegisterEntryDoc>,
      page: query.page,
      pageSize: query.pageSize,
      // DEC-21: no sort asked for → the Excel's own order, oldest row first.
      sortBy: sortBy ?? 'createdAt',
      sortDir: sortBy === undefined ? 'asc' : query.sortDir,
      sortableFields: ATM_REGISTER_SORT_FIELDS,
      scope: scopeSelector(ctx, 'atmRegister.view'),
    });
    return { items: await this.toDtos(page.items, ctx), meta: page.meta };
  }

  async get(id: string, ctx: AuthContext): Promise<AtmRegisterEntryDto> {
    const doc = await atmRegisterEntryRepository.getById(
      id,
      scopeSelector(ctx, 'atmRegister.view'),
    );
    return this.toDto(doc, ctx);
  }

  /** One page of entries → DTOs: ONE settings read and ONE master read per page. */
  async toDtos(
    docs: readonly AtmRegisterEntryDoc[],
    ctx: AuthContext,
    known?: RegisterSettings,
  ): Promise<AtmRegisterEntryDto[]> {
    const settings = known ?? (await resolveRegisterSettings());
    const machineIds = [
      ...new Set(docs.flatMap((doc) => (doc.machineId === null ? [] : [String(doc.machineId)]))),
    ];
    // Deleted masters INCLUDED — "deleted" is a state the grid shows (DEC-24).
    const masters =
      machineIds.length === 0
        ? []
        : await AtmMachineModel.find(
            { _id: { $in: machineIds.map((id) => new Types.ObjectId(id)) } },
            { isActive: 1, isDeleted: 1 },
          )
            .lean<Pick<AtmMachineDoc, '_id' | 'isActive' | 'isDeleted'>[]>()
            .exec();
    const states = new Map<string, AtmRegisterLinkedMasterState>(
      masters.map((m) => [
        String(m._id),
        m.isDeleted ? 'deleted' : m.isActive ? 'active' : 'archived',
      ]),
    );
    return docs.map((doc) =>
      toAtmRegisterEntryDto(doc, {
        secretsVisible: secretsVisibleFor(ctx, doc),
        branchCode:
          doc.branchId === null
            ? null
            : (settings.codeByBranchId.get(String(doc.branchId)) ?? null),
        settingOpsLabel: doc.bankCode === null ? null : settings.opsLabel(doc.bankCode),
        linkedMasterState:
          doc.machineId === null ? 'missing' : (states.get(String(doc.machineId)) ?? 'missing'),
      }),
    );
  }

  private async toDto(
    doc: AtmRegisterEntryDoc,
    ctx: AuthContext,
    settings?: RegisterSettings,
  ): Promise<AtmRegisterEntryDto> {
    const [dto] = await this.toDtos([doc], ctx, settings);
    return dto as AtmRegisterEntryDto;
  }

  // ── Shared checks ─────────────────────────────────────────────────────────────────────────────

  /** DEC-7: whoever writes a secret must be able to read it, over THIS entry's branch. */
  private assertSecretsWritable(
    ctx: AuthContext,
    input: Parameters<typeof writesSecrets>[0],
    entry: { branchId: Types.ObjectId | string | null },
  ): void {
    if (writesSecrets(input) && !secretsVisibleFor(ctx, entry)) {
      throw new ForbiddenError(
        'writing machine keys, their notes or the combination needs atmRegister.viewSecrets over this branch',
      );
    }
  }

  private assertCovers(ctx: AuthContext, key: string, entry: AtmRegisterEntryDoc): void {
    if (!keyCoversEntry(ctx, key, entry)) {
      throw new ForbiddenError(`${key} does not reach this entry's branch`);
    }
  }

  /** A receipt's branch: it exists, it is active (D4 — the fleet `assertBranch` shape). */
  private async assertActiveBranch(branchId: string): Promise<void> {
    const branch = await branchRepository.findById(branchId);
    if (branch === null || branch.status !== 'active') {
      throw new ValidationError([
        { field: 'body.branchId', code: 'UNKNOWN', message: 'branch not found or inactive' },
      ]);
    }
  }

  /** DEC-10: a receipt's branch must be mapped to an EGYCASH code. */
  private assertMapped(branchId: string, settings: RegisterSettings): void {
    if (!settings.codeByBranchId.has(branchId)) {
      throw new BusinessRuleError(
        'this branch has no EGYCASH code in the register settings',
        ErrorCodes.ATM_REGISTER_BRANCH_UNMAPPED,
      );
    }
  }

  /** D5: an override must be one of the branch's ACTIVE Operations bank labels. */
  private async assertOpsBankLabel(
    branchId: Types.ObjectId | string | null,
    label: string,
  ): Promise<void> {
    const found =
      branchId === null
        ? null
        : await AtmRefLabelModel.exists({
            branchId: new Types.ObjectId(String(branchId)),
            kind: 'bank',
            name: label,
            isActive: true,
            isDeleted: false,
          }).exec();
    if (found === null) {
      throw new ValidationError([
        {
          field: 'body.opsBankLabel',
          code: 'UNKNOWN',
          message: 'not an active Operations bank label of this branch',
        },
      ]);
    }
  }

  /**
   * How a refusal names ANOTHER branch: by its EGYCASH code only when the caller's
   * `atmRegister.view` reaches it (review finding F-9) — never a branch the caller cannot see.
   */
  private describeBranch(
    ctx: AuthContext,
    branchId: Types.ObjectId | string | null | undefined,
    settings: RegisterSettings,
  ): string {
    if (branchId === null || branchId === undefined) return 'an entry with no branch';
    const code = settings.codeByBranchId.get(String(branchId));
    return code !== undefined && keyReachesBranch(ctx, 'atmRegister.view', String(branchId))
      ? code
      : 'another branch';
  }

  /** D6: one OPEN period per code, company-wide (exempt pairs count here — DEC-11). */
  private async assertNoOpenPeriod(
    ctx: AuthContext,
    machineCode: string,
    settings: RegisterSettings,
    excludeEntryId?: string,
  ): Promise<void> {
    const open = (await atmRegisterEntryRepository.findOpenByCode(machineCode)).filter(
      (row) => excludeEntryId === undefined || String(row._id) !== excludeEntryId,
    );
    const other = open[0];
    if (other !== undefined) {
      throw new ConflictError(
        `machine ${machineCode} already has an open period in ${this.describeBranch(ctx, other.branchId, settings)}`,
        ErrorCodes.ATM_REGISTER_OPEN_PERIOD_EXISTS,
      );
    }
  }

  private openPeriodRace(machineCode: string | null): ConflictError {
    return new ConflictError(
      `machine ${machineCode ?? ''} already has an open period`,
      ErrorCodes.ATM_REGISTER_OPEN_PERIOD_EXISTS,
    );
  }

  /** A coupling refusal as the HTTP answer a manual write gives (§5.6). */
  private refusalError(
    refusal: CouplingRefusal,
    machineCode: string,
    ctx: AuthContext,
    settings: RegisterSettings,
  ): AppError {
    if (refusal.refused === 'activeElsewhere') {
      return new ConflictError(
        `machine ${machineCode} is active in the Operations list of ${this.describeBranch(ctx, refusal.otherBranchId, settings)}`,
        ErrorCodes.ATM_REGISTER_CODE_ACTIVE_ELSEWHERE,
      );
    }
    if (refusal.refused === 'blankArea') {
      return new AppError(
        ErrorCodes.ATM_REGISTER_AREA_REQUIRED,
        400,
        'an area is required to add the machine to the Operations list',
        { details: [{ field: 'body.area', code: 'REQUIRED', message: 'area is required' }] },
      );
    }
    return new ValidationError([
      { field: 'body.name', code: 'REQUIRED', message: 'a name is required to couple the entry' },
    ]);
  }

  /** Read-only notices a write returns beside its result (D6, DEC-14). */
  private async warningsFor(
    entry: {
      bankCode: AtmBankCode | null;
      machineCode: string | null;
      serial: string | null;
      status: string;
      startDate: Date | null;
      endDate: Date | null;
    },
    checks: {
      code: boolean;
      serial: boolean;
      dates: string[];
      order: boolean;
      excludeEntryId?: string;
    },
  ): Promise<AtmRegisterWarning[]> {
    const warnings: AtmRegisterWarning[] = [];
    if (
      checks.code &&
      entry.bankCode !== null &&
      entry.machineCode !== null &&
      !atmRegisterIdFormatOk(entry.bankCode, entry.machineCode)
    ) {
      warnings.push('idFormat');
    }
    if (
      checks.serial &&
      entry.serial !== null &&
      entry.status !== 'ended' &&
      (await atmRegisterEntryRepository.findSerialOnOtherOpen(
        entry.serial,
        entry.machineCode,
        checks.excludeEntryId,
      ))
    ) {
      warnings.push('serialDuplicate');
    }
    if (
      checks.order &&
      entry.startDate !== null &&
      entry.endDate !== null &&
      entry.endDate.getTime() < entry.startDate.getTime()
    ) {
      warnings.push('endBeforeStart');
    }
    const today = cairoToday();
    if (checks.dates.some((day) => day > today)) warnings.push('futureDate');
    return warnings;
  }

  private writeResult(
    dto: AtmRegisterEntryDto,
    warnings: AtmRegisterWarning[],
    action: AtmRegisterMasterAction,
  ): AtmRegisterWriteResultDto {
    return {
      entry: dto,
      warnings: [...new Set(warnings)],
      master: { action, machineId: dto.machineId },
    };
  }

  /** Link-specific notices (D5, DEC-8). */
  private linkWarnings(
    outcome: CouplingOutcome,
    requestedLabel: string | null | undefined,
  ): AtmRegisterWarning[] {
    if (outcome.action !== 'link') return [];
    const warnings: AtmRegisterWarning[] = [];
    if (typeof requestedLabel === 'string' && requestedLabel !== outcome.adoptedBankLabel) {
      warnings.push('opsBankLabelIgnored');
    }
    if (outcome.differences.length > 0) warnings.push('masterDiffers');
    return warnings;
  }

  // ── Writes ────────────────────────────────────────────────────────────────────────────────────

  /** POST /entries — Receive (startDate set) or a pending entry (startDate absent). */
  async create(
    input: ReceiveAtmRegisterEntry,
    ctx: AuthContext,
  ): Promise<AtmRegisterWriteResultDto> {
    this.assertSecretsWritable(ctx, input, { branchId: input.branchId });
    await this.assertActiveBranch(input.branchId);
    if (!keyReachesBranch(ctx, 'atmRegister.create', input.branchId)) {
      throw new ForbiddenError('atmRegister.create does not reach this branch');
    }
    const settings = await resolveRegisterSettings();
    this.assertMapped(input.branchId, settings);

    const normalized =
      input.machineCode === undefined ? '' : normalizeAtmMachineCode(input.machineCode);
    const machineCode = normalized === '' ? null : normalized;
    const startDate = input.startDate ?? null;
    // `#` / `********` are the workbook's "no real code" markers: never an Operations machine (the
    // same refusal the pending-receive and Link paths make, DEC-30).
    if (startDate !== null && machineCode !== null && isPlaceholderMachineCode(machineCode)) {
      throw new ValidationError([
        {
          field: 'body.machineCode',
          code: 'REQUIRED',
          message: 'a placeholder is not a machine code',
        },
      ]);
    }
    const requestedLabel = input.opsBankLabel ?? null;
    if (requestedLabel !== null) await this.assertOpsBankLabel(input.branchId, requestedLabel);
    const bankCode = input.bankCode ?? null;
    const area = input.area ?? null;
    if (startDate !== null && machineCode !== null) {
      await this.assertNoOpenPeriod(ctx, machineCode, settings);
    }
    const serial = input.serial ?? null;
    const warnings = await this.warningsFor(
      {
        bankCode,
        machineCode,
        serial,
        status: deriveAtmRegisterStatus(startDate, null),
        startDate: startDate === null ? null : businessDate(startDate),
        endDate: null,
      },
      { code: true, serial: true, dates: startDate === null ? [] : [startDate], order: false },
    );

    // The id exists BEFORE the insert so the combination's sealing context can name it.
    const id = new Types.ObjectId();
    const combination =
      input.safeCombination === undefined || input.safeCombination === null
        ? null
        : await sealCombination(String(id), input.safeCombination);

    const { doc, coupling } = await unitOfWork(async (session) => {
      let outcome: CouplingOutcome | null = null;
      if (startDate !== null && machineCode !== null && bankCode !== null) {
        const result = await coupleReceipt(
          {
            branchId: input.branchId,
            machineCode,
            name: input.name,
            area,
            opsLabel: requestedLabel ?? settings.opsLabel(bankCode),
          },
          ctx.userId,
          session,
        );
        if (isCouplingRefusal(result)) throw this.refusalError(result, machineCode, ctx, settings);
        outcome = result;
      }
      const keys = Object.fromEntries(
        REGISTER_KEY_FIELDS.map((field) => [field, input.keys?.[field] ?? null]),
      );
      const cassettes = Object.fromEntries(
        REGISTER_CASSETTE_FIELDS.map((field) => [field, input.cassettes?.[field] ?? null]),
      );
      try {
        const created = await atmRegisterEntryRepository.create(
          {
            _id: id,
            branchId: new Types.ObjectId(input.branchId),
            area,
            bankCode,
            opsBankLabel: outcome?.action === 'link' ? outcome.adoptedBankLabel : requestedLabel,
            machineCode,
            machineId: outcome?.machineId ?? null,
            name: input.name,
            ...Object.fromEntries(PLAIN_TEXT_FIELDS.map((field) => [field, input[field] ?? null])),
            keys: keys as unknown as AtmRegisterEntryDoc['keys'],
            cassettes: cassettes as unknown as AtmRegisterEntryDoc['cassettes'],
            receiptNotes: input.receiptNotes ?? null,
            safeCombination: combination,
            startDate: startDate === null ? null : businessDate(startDate),
            endDate: null,
            handoverName: null,
            handoverNotes: null,
            status: deriveAtmRegisterStatus(startDate, null),
            openPeriodExempt: false,
            source: 'manual',
            importRunId: null,
            importRow: null,
            importIssues: [],
            legacyMarks: null,
          },
          { by: ctx.userId, session },
        );
        return { doc: created, coupling: outcome };
      } catch (error) {
        // The partial unique index is the race-proof half of D6.
        if (error instanceof ConflictError) throw this.openPeriodRace(machineCode);
        throw error;
      }
    });

    await recordAll([
      {
        entityRef: entryRef(String(doc._id)),
        action: 'create',
        changes: redactedDiff({}, entrySnapshot(doc)),
      },
      ...(coupling?.audits ?? []),
    ]);
    return this.writeResult(
      await this.toDto(doc, ctx, settings),
      [...warnings, ...(coupling === null ? [] : this.linkWarnings(coupling, requestedLabel))],
      coupling?.action ?? 'none',
    );
  }

  /** PATCH /entries/:id — partial; `keys`/`cassettes` merge per sub-field. */
  async update(
    id: string,
    input: UpdateAtmRegisterEntry,
    ctx: AuthContext,
  ): Promise<AtmRegisterWriteResultDto> {
    const scope = scopeSelector(ctx, 'atmRegister.edit');
    const before = await atmRegisterEntryRepository.getById(id, scope);
    this.assertCovers(ctx, 'atmRegister.edit', before);
    this.assertSecretsWritable(ctx, input, before);
    if (before.__v !== input.version) throw new StaleDocumentError();
    const settings = await resolveRegisterSettings();

    const set: Record<string, unknown> = {};
    const merged: AtmRegisterEntryDoc = {
      ...before,
      keys: { ...before.keys },
      cassettes: { ...before.cassettes },
    };
    const put = <K extends keyof AtmRegisterEntryDoc>(
      field: K,
      value: AtmRegisterEntryDoc[K],
    ): void => {
      set[field] = value;
      merged[field] = value;
    };

    for (const field of PLAIN_TEXT_FIELDS) {
      const value = input[field];
      if (value !== undefined) put(field, value);
    }
    if (input.name !== undefined) put('name', input.name);
    if (input.receiptNotes !== undefined) put('receiptNotes', input.receiptNotes);

    if (input.area !== undefined) {
      // D6: an open machine in the Operations list always has an area.
      if (input.area === null && before.status === 'open' && before.machineId !== null) {
        throw new ValidationError([
          { field: 'body.area', code: 'REQUIRED', message: 'an open, linked entry keeps its area' },
        ]);
      }
      put('area', input.area);
    }
    if (input.bankCode !== undefined) {
      put('bankCode', input.bankCode);
      // DEC-25: a label chosen for one bank means nothing for another.
      if (input.bankCode !== before.bankCode && input.opsBankLabel === undefined) {
        put('opsBankLabel', null);
      }
    }
    if (input.opsBankLabel !== undefined) {
      if (input.opsBankLabel !== null)
        await this.assertOpsBankLabel(before.branchId, input.opsBankLabel);
      put('opsBankLabel', input.opsBankLabel);
    }

    let codeChanged = false;
    if (input.machineCode !== undefined) {
      const normalized = normalizeAtmMachineCode(input.machineCode);
      const code = normalized === '' ? null : normalized;
      if (code !== before.machineCode) {
        // DEC-30: the code is identity once a master holds it.
        const editable =
          before.status === 'pending' || (before.status === 'open' && before.machineId === null);
        if (!editable) {
          throw new BusinessRuleError(
            'the machine code cannot change once the entry is linked to an Operations machine',
            ErrorCodes.ATM_REGISTER_IMMUTABLE_FIELD,
          );
        }
        if (before.status === 'open' && code !== null) {
          await this.assertNoOpenPeriod(ctx, code, settings, id);
        }
        put('machineCode', code);
        codeChanged = true;
      }
    }

    if (input.startDate !== undefined) {
      if (before.status === 'pending') {
        throw new BusinessRuleError(
          'a pending entry is received through its receive action, not an edit',
          ErrorCodes.ATM_REGISTER_NOT_OPEN,
        );
      }
      put('startDate', businessDate(input.startDate));
    }
    if (
      input.endDate !== undefined ||
      input.handoverName !== undefined ||
      input.handoverNotes !== undefined
    ) {
      if (before.status !== 'ended') {
        throw new BusinessRuleError(
          'the handover fields are edited only on an ended entry',
          ErrorCodes.ATM_REGISTER_NOT_ENDED,
        );
      }
      if (input.endDate !== undefined) put('endDate', businessDate(input.endDate));
      if (input.handoverName !== undefined) put('handoverName', input.handoverName);
      if (input.handoverNotes !== undefined) put('handoverNotes', input.handoverNotes);
    }

    for (const field of REGISTER_KEY_FIELDS) {
      const value = input.keys?.[field];
      if (value === undefined) continue;
      set[`keys.${field}`] = value;
      merged.keys[field] = value;
    }
    for (const field of REGISTER_CASSETTE_FIELDS) {
      const value = input.cassettes?.[field];
      if (value === undefined) continue;
      set[`cassettes.${field}`] = value;
      merged.cassettes[field] = value;
    }
    if (input.safeCombination !== undefined) {
      put(
        'safeCombination',
        input.safeCombination === null ? null : await sealCombination(id, input.safeCombination),
      );
    }
    // Derived, never input (D1). An edit cannot move it: start is never set on a pending entry and
    // the end only exists on an ended one.
    put('status', deriveAtmRegisterStatus(merged.startDate, merged.endDate));

    const opsLabelBefore = effectiveOpsLabel(before, settings);
    // DEC-30: setting the area of an OPEN, unlinked entry is what couples it to Operations.
    const tryLink =
      before.status === 'open' &&
      before.machineId === null &&
      input.area !== undefined &&
      input.area !== null &&
      uncoupledPrecondition(merged) === null;

    const warnings = await this.warningsFor(merged, {
      code: codeChanged || input.bankCode !== undefined,
      serial: input.serial !== undefined || codeChanged,
      dates: [input.startDate, input.endDate].filter((day): day is string => day !== undefined),
      order: input.startDate !== undefined || input.endDate !== undefined,
      excludeEntryId: id,
    });

    const result = await unitOfWork(async (session) => {
      const audits: PendingAudit[] = [];
      const txWarnings: AtmRegisterWarning[] = [];
      const write: Record<string, unknown> = { ...set };
      let action: AtmRegisterMasterAction = 'none';
      if (tryLink) {
        const outcome = await linkUncoupled(
          merged,
          effectiveOpsLabel(merged, settings) ?? '',
          ctx.userId,
          session,
        );
        if (isCouplingRefusal(outcome)) {
          // The edit is saved either way; only the cross-branch conflict is worth telling.
          if (outcome.refused === 'activeElsewhere') txWarnings.push('codeActiveElsewhere');
        } else {
          write.machineId = outcome.machineId;
          if (outcome.action === 'link') write.opsBankLabel = outcome.adoptedBankLabel;
          txWarnings.push(...this.linkWarnings(outcome, input.opsBankLabel));
          audits.push(...outcome.audits);
          action = outcome.action;
        }
      }
      let updated: AtmRegisterEntryDoc;
      try {
        updated = await atmRegisterEntryRepository.updateById(id, write, {
          by: ctx.userId,
          version: input.version,
          scope,
          session,
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) throw this.openPeriodRace(merged.machineCode);
        throw error;
      }
      if (before.status === 'open' && before.machineId !== null) {
        const synced = await syncEntryToMaster(
          before,
          updated,
          opsLabelBefore,
          effectiveOpsLabel(updated, settings),
          ctx.userId,
          session,
        );
        if (synced.length > 0) action = 'sync';
        audits.push(...synced);
      }
      return { updated, audits, action, txWarnings };
    });

    await recordAll([
      {
        entityRef: entryRef(id),
        action: 'update',
        changes: redactedDiff(entrySnapshot(before), entrySnapshot(result.updated)),
      },
      ...result.audits,
    ]);
    return this.writeResult(
      await this.toDto(result.updated, ctx, settings),
      [...warnings, ...result.txWarnings],
      result.action,
    );
  }

  /** POST /entries/:id/receive — a pending entry becomes open (DEC-12). */
  async receivePending(
    id: string,
    input: ReceivePendingAtmRegisterEntry,
    ctx: AuthContext,
  ): Promise<AtmRegisterWriteResultDto> {
    const scope = scopeSelector(ctx, 'atmRegister.create');
    const before = await atmRegisterEntryRepository.getById(id, scope);
    this.assertCovers(ctx, 'atmRegister.create', before);
    if (before.status !== 'pending') {
      throw new BusinessRuleError('the entry is not pending', ErrorCodes.ATM_REGISTER_NOT_PENDING);
    }
    // Branch is immutable (D4): a branch-less pending row is deleted and received anew.
    if (before.branchId === null) {
      throw new BusinessRuleError(
        'an entry without a branch cannot be received — delete it and record a new receipt',
        ErrorCodes.ATM_REGISTER_BRANCH_REQUIRED,
      );
    }
    if (before.__v !== input.version) throw new StaleDocumentError();
    const branchId = String(before.branchId);
    await this.assertActiveBranch(branchId);
    if (!keyReachesBranch(ctx, 'atmRegister.create', branchId)) {
      throw new ForbiddenError('atmRegister.create does not reach this branch');
    }
    const settings = await resolveRegisterSettings();
    this.assertMapped(branchId, settings);

    const area = input.area !== undefined ? input.area : before.area;
    const bankCode = input.bankCode ?? before.bankCode;
    const normalized =
      input.machineCode === undefined
        ? before.machineCode
        : normalizeAtmMachineCode(input.machineCode);
    const machineCode = normalized === null || normalized === '' ? null : normalized;
    const bankChanged = bankCode !== before.bankCode;
    const opsBankLabel =
      input.opsBankLabel !== undefined
        ? input.opsBankLabel
        : bankChanged
          ? null
          : before.opsBankLabel;
    const missing: { field: string; code: string; message: string }[] = [];
    if (bankCode === null)
      missing.push({ field: 'body.bankCode', code: 'REQUIRED', message: 'bank is required' });
    if (machineCode === null || isPlaceholderMachineCode(machineCode)) {
      missing.push({
        field: 'body.machineCode',
        code: 'REQUIRED',
        message: 'machine code is required',
      });
    }
    if (area === null)
      missing.push({ field: 'body.area', code: 'REQUIRED', message: 'area is required' });
    if (before.name === null)
      missing.push({ field: 'body.name', code: 'REQUIRED', message: 'name is required' });
    if (missing.length > 0 || bankCode === null || machineCode === null)
      throw new ValidationError(missing);
    if (input.opsBankLabel !== undefined && input.opsBankLabel !== null) {
      await this.assertOpsBankLabel(branchId, input.opsBankLabel);
    }
    await this.assertNoOpenPeriod(ctx, machineCode, settings, id);
    const warnings = await this.warningsFor(
      {
        bankCode,
        machineCode,
        serial: before.serial,
        status: 'open',
        startDate: businessDate(input.startDate),
        endDate: null,
      },
      { code: true, serial: true, dates: [input.startDate], order: false, excludeEntryId: id },
    );

    const result = await unitOfWork(async (session) => {
      const outcome = await coupleReceipt(
        {
          branchId,
          machineCode,
          name: before.name,
          area,
          opsLabel: opsBankLabel ?? settings.opsLabel(bankCode),
        },
        ctx.userId,
        session,
      );
      if (isCouplingRefusal(outcome)) throw this.refusalError(outcome, machineCode, ctx, settings);
      try {
        const updated = await atmRegisterEntryRepository.updateById(
          id,
          {
            startDate: businessDate(input.startDate),
            area,
            bankCode,
            machineCode,
            opsBankLabel: outcome.action === 'link' ? outcome.adoptedBankLabel : opsBankLabel,
            ...(input.receivedByName === undefined ? {} : { receivedByName: input.receivedByName }),
            status: 'open',
            machineId: outcome.machineId,
          },
          { by: ctx.userId, version: input.version, scope, session },
        );
        return { updated, outcome };
      } catch (error) {
        if (isDuplicateKeyError(error)) throw this.openPeriodRace(machineCode);
        throw error;
      }
    });

    await recordAll([
      {
        entityRef: entryRef(id),
        action: 'statusChange',
        changes: redactedDiff(entrySnapshot(before), entrySnapshot(result.updated)),
      },
      ...result.outcome.audits,
    ]);
    return this.writeResult(
      await this.toDto(result.updated, ctx, settings),
      [...warnings, ...this.linkWarnings(result.outcome, input.opsBankLabel)],
      result.outcome.action,
    );
  }

  /** POST /entries/:id/handover — open → ended; the master is archived when no other period holds it. */
  async handover(
    id: string,
    input: HandoverAtmRegisterEntry,
    ctx: AuthContext,
  ): Promise<AtmRegisterWriteResultDto> {
    const scope = scopeSelector(ctx, 'atmRegister.handover');
    const before = await atmRegisterEntryRepository.getById(id, scope);
    this.assertCovers(ctx, 'atmRegister.handover', before);
    if (before.status !== 'open') throw notOpen();
    this.assertSecretsWritable(ctx, { handoverNotes: input.handoverNotes }, before);
    if (before.__v !== input.version) throw new StaleDocumentError();
    const settings = await resolveRegisterSettings();
    const endDate = businessDate(input.endDate);
    // DEC-14: an end before the start, or in the future, is accepted with a notice.
    const warnings = await this.warningsFor(
      { ...before, endDate },
      { code: false, serial: false, dates: [input.endDate], order: true },
    );

    const result = await unitOfWork(async (session) => {
      // An ABSENT field keeps the stored value: 8 imported open rows already carry a delivered
      // name and 7 a delivered note (review finding F-18). A sent value — '' included — replaces it.
      const updated = await atmRegisterEntryRepository.updateById(
        id,
        {
          endDate,
          status: deriveAtmRegisterStatus(before.startDate, endDate),
          ...(input.handoverName === undefined ? {} : { handoverName: input.handoverName }),
          ...(input.handoverNotes === undefined ? {} : { handoverNotes: input.handoverNotes }),
        },
        { by: ctx.userId, version: input.version, scope, session },
      );
      const audits = await archiveIfLastOpen(updated, ctx.userId, session);
      return { updated, audits };
    });

    await recordAll([
      {
        entityRef: entryRef(id),
        action: 'statusChange',
        changes: redactedDiff(entrySnapshot(before), entrySnapshot(result.updated)),
      },
      ...result.audits,
    ]);
    return this.writeResult(
      await this.toDto(result.updated, ctx, settings),
      warnings,
      result.audits.length > 0 ? 'archive' : 'none',
    );
  }

  /** DELETE /entries/:id — a mistaken entry; an open one releases its master (D2). */
  async remove(id: string, version: number, ctx: AuthContext): Promise<void> {
    const scope = scopeSelector(ctx, 'atmRegister.delete');
    const before = await atmRegisterEntryRepository.getById(id, scope);
    this.assertCovers(ctx, 'atmRegister.delete', before);
    if (before.__v !== version) throw new StaleDocumentError();
    const audits = await unitOfWork(async (session) => {
      await atmRegisterEntryRepository.softDeleteById(id, { by: ctx.userId, scope, session });
      return before.status === 'open' ? archiveIfLastOpen(before, ctx.userId, session) : [];
    });
    await recordAll([
      {
        entityRef: entryRef(id),
        action: 'delete',
        changes: redactedDiff(entrySnapshot(before), {}),
      },
      ...audits,
    ]);
  }

  /**
   * POST /entries/:id/reveal — the ONE path that opens a combination (D3). Checked with the same
   * predicate the grid uses BEFORE anything is opened, and ALWAYS audited — also when nothing is
   * recorded (the medical-record-read rule: somebody asked).
   */
  async reveal(id: string, ctx: AuthContext): Promise<AtmRegisterRevealDto> {
    const doc = await atmRegisterEntryRepository.getById(
      id,
      scopeSelector(ctx, 'atmRegister.viewSecrets'),
    );
    if (!secretsVisibleFor(ctx, doc)) {
      throw new ForbiddenError('atmRegister.viewSecrets does not reach this entry’s branch');
    }
    const value =
      doc.safeCombination === null ? null : await openCombination(id, doc.safeCombination);
    await auditService.record({
      entityRef: entryRef(id),
      action: 'secretRevealed',
      changes: [
        { field: 'safeCombination', old: null, new: value === null ? '[none]' : '[revealed]' },
      ],
    });
    return { safeCombination: value };
  }

  /** POST /entries/:id/link — couple an OPEN, unlinked entry to Operations (DEC-30). */
  async link(id: string, version: number, ctx: AuthContext): Promise<AtmRegisterWriteResultDto> {
    const scope = scopeSelector(ctx, 'atmRegister.edit');
    const before = await atmRegisterEntryRepository.getById(id, scope);
    this.assertCovers(ctx, 'atmRegister.edit', before);
    if (before.status !== 'open') throw notOpen();
    if (before.machineId !== null) {
      throw new BusinessRuleError(
        'the entry is already linked to an Operations machine',
        ErrorCodes.ATM_REGISTER_ALREADY_LINKED,
      );
    }
    if (before.__v !== version) throw new StaleDocumentError();
    const precondition = uncoupledPrecondition(before);
    if (precondition === 'noBranch') {
      throw new BusinessRuleError(
        'an entry without a branch cannot be linked',
        ErrorCodes.ATM_REGISTER_BRANCH_REQUIRED,
      );
    }
    if (precondition === 'noCode') {
      throw new ValidationError([
        {
          field: 'body.machineCode',
          code: 'REQUIRED',
          message: 'the entry has no usable machine code',
        },
      ]);
    }
    if (precondition === 'noBank' || before.bankCode === null) {
      throw new ValidationError([
        { field: 'body.bankCode', code: 'REQUIRED', message: 'the entry has no bank' },
      ]);
    }
    const settings = await resolveRegisterSettings();
    const opsLabel = effectiveOpsLabel(before, settings) ?? settings.opsLabel(before.bankCode);

    const result = await unitOfWork(async (session) => {
      const outcome = await linkUncoupled(before, opsLabel, ctx.userId, session);
      if (isCouplingRefusal(outcome)) {
        throw this.refusalError(outcome, before.machineCode ?? '', ctx, settings);
      }
      const updated = await atmRegisterEntryRepository.updateById(
        id,
        {
          machineId: outcome.machineId,
          ...(outcome.action === 'link' ? { opsBankLabel: outcome.adoptedBankLabel } : {}),
        },
        { by: ctx.userId, version, scope, session },
      );
      return { updated, outcome };
    });

    await recordAll([
      {
        entityRef: entryRef(id),
        action: 'update',
        changes: redactedDiff(entrySnapshot(before), entrySnapshot(result.updated)),
      },
      ...result.outcome.audits,
    ]);
    return this.writeResult(
      await this.toDto(result.updated, ctx, settings),
      this.linkWarnings(result.outcome, undefined),
      result.outcome.action,
    );
  }

  // ── Reference data for the screens ────────────────────────────────────────────────────────────

  /** GET /meta — banks with their labels and colours; the seven codes with their mapped branch. */
  async meta(ctx: AuthContext): Promise<AtmRegisterMetaDto> {
    const settings = await resolveRegisterSettings();
    const branches = await branchRepository.findByIdsSystem([...settings.branchIdByCode.values()]);
    const byId = new Map(branches.map((branch) => [String(branch._id), branch]));
    return {
      banks: ATM_BANK_CODES.map((code) => ({
        code,
        name: ATM_BANK_NAMES[code],
        opsLabel: settings.opsLabel(code),
        color: ATM_BANK_REPORT_COLORS[code],
      })),
      branches: ATM_REGISTER_BRANCH_CODES.map((code) => {
        const branchId = settings.branchIdByCode.get(code) ?? null;
        const branch = branchId === null ? undefined : byId.get(branchId);
        return {
          code,
          name: ATM_REGISTER_BRANCH_NAMES[code],
          branchId,
          branchName: branch === undefined ? null : branch.name,
          branchActive: branch !== undefined && !branch.isDeleted && branch.status === 'active',
          canView: branchId !== null && keyReachesBranch(ctx, 'atmRegister.view', branchId),
          canCreate: branchId !== null && keyReachesBranch(ctx, 'atmRegister.create', branchId),
        };
      }),
    };
  }

  /** GET /branch-options — what the receive/edit form offers for one branch. */
  async branchOptions(branchId: string, ctx: AuthContext): Promise<AtmRegisterBranchOptionsDto> {
    if (
      !keyReachesBranch(ctx, 'atmRegister.view', branchId) &&
      !keyReachesBranch(ctx, 'atmRegister.create', branchId)
    ) {
      throw new ForbiddenError('the register keys do not reach this branch');
    }
    const labels = await AtmRefLabelModel.find(
      { branchId: new Types.ObjectId(branchId), isActive: true, isDeleted: false },
      { kind: 1, name: 1 },
    )
      .lean<{ kind: string; name: string }[]>()
      .exec();
    const sorted = (kind: string): string[] =>
      labels
        .filter((label) => label.kind === kind)
        .map((label) => label.name)
        .sort((a, b) => a.localeCompare(b));
    const [areas, operationTypes, vendors, models, hubs] = await Promise.all([
      atmRegisterEntryRepository.distinctValues('area', branchId),
      atmRegisterEntryRepository.distinctValues('operationType', branchId),
      atmRegisterEntryRepository.distinctValues('vendor', branchId),
      atmRegisterEntryRepository.distinctValues('model', branchId),
      atmRegisterEntryRepository.distinctValues('hub', branchId),
    ]);
    return {
      branchId,
      areaLabels: sorted('area'),
      bankLabels: sorted('bank'),
      areas,
      operationTypes,
      vendors,
      models,
      hubs,
    };
  }
}

export const atmRegisterService = new AtmRegisterService();
