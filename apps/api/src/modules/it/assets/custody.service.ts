// Custody: assign · return · transfer · dispose (design §2.5, §4.3, ADR-021) — and «نقل إلى فرع»,
// the move of several assets to another branch, a held one moving with its custody.
//
// NAMED actions, never a generic PATCH, because each is a distinct business act with its own
// guard, event, audit action and history entry. Each runs in ONE transaction (FR-3) that writes:
//
//     assignment row  +  asset denormalization  +  history event  +  platform event  +  audit
//
// A partial custody write must be impossible. That is why this is a `unitOfWork` and not five
// sequential awaits — and why the "one open assignment per asset" invariant is a partial unique
// index on the collection rather than the `findOpen` check below. The check produces the good
// error message; the index is what actually holds under two concurrent assigns.
//
// The platform event is emitted AFTER the transaction commits. Subscribers react to facts, and a
// fact that later rolled back is not one — the outbox exists for delivery, not for undo. The
// transfer and the move write their audit rows after the commit too (`transferInSession` says
// why); hand-over, return and dispose still write theirs inside the transaction.
import { Types } from 'mongoose';
import {
  ItEvents,
  type AssignItAsset,
  type DisposeItAsset,
  type HandOverItAssets,
  type ItAssetEventType,
  type ItAssetTransferredPayload,
  type ItAssetsBranchMoveResultDto,
  type ItMoveTargetsDto,
  type ListItAssetHistoryQuery,
  type MoveItAssetsToBranch,
  type Paginated,
  type ReturnItAsset,
  type TransferItAsset,
} from '@ecms/contracts';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { keyReachesBranch, type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService, type AuditEntry } from '../../../platform/audit';
import { type DirectoryEmployee } from '../../../platform/directory';
import { branchRepository } from '../../../platform/organization';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { logger } from '../../../infrastructure/logging/logger';
import { itAssetRepository } from './asset.repository';
import { itAssetAssignmentRepository } from './assignment.repository';
import { itAssetEventRepository } from './asset-event.repository';
import { itMaintenanceOrderRepository } from '../maintenance/order.repository';
import { type ItAssetEventDoc } from './asset-event.model';
import { type ItAssetAssignmentDoc } from './assignment.model';
import { type ItAssetDoc } from './asset.model';
import { itCustodyReceiptRepository } from './receipt.repository';
import { type ItCustodyReceiptDoc, type ItCustodyReceiptLineSub } from './receipt.model';
import { readReceiptHolder, type ReceiptHolder } from './receipt-holder';
import {
  employeeHolderId,
  holderAuditChanges,
  holderHistory,
  holderOfInterval,
  holderOfRequest,
  intervalHolderFields,
  sameHolder as isSameHolder,
  signerOf,
  type CustodyHolder,
  type DepartmentHolder,
} from './custody-holder';
import {
  custodianRefusal,
  custodianSnapshot,
  readCustodian,
  refuseOutsidePlaceBranch,
  type CustodianRead,
} from './custodian';
import { claimReceiptNumber, receiptNumberFor } from './receipt-number';
import { readDeviceTypesOf, receiptDeviceFields } from './receipt-device';
import {
  assetMoveRefusal,
  assetMoveRefusalError,
  assetsBranchMoveResult,
  moveTargetBranchIds,
  type AssetMoveRefusal,
} from './asset-move';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'asset', entityId: id });

const actorNameOf = (ctx: AuthContext): string =>
  ctx.identity?.displayName?.[ctx.locale === 'ar' ? 'ar' : 'en'] ?? '';

/** Audit rows for custody carry the transition, not a field-by-field diff of the whole asset. */
const change = (field: string, from: unknown, to: unknown) => ({ field, old: from, new: to });

/**
 * Custody is handed only to somebody who works here today — «فى حاله الاضافه اللى موجود بس».
 *
 * The holder box on assign and transfer offers the employed alone; this is the same rule where a
 * stale dialog, a second tab or a direct call cannot step around it. The custody register's
 * SEARCH finds leavers on purpose, which is exactly why the rule cannot rest on which list a box
 * happened to load.
 *
 * It refuses on a POSITIVE answer only. An id the directory cannot read — a deployment with no HR
 * source, or a person it does not know — leaves the action exactly as it was: this adds the one
 * fact HR can state, not a new dependency on HR answering at all. On leave and suspended are still
 * employed, and still receive custody.
 */
export const refuseLeaver = (employee: DirectoryEmployee | null): void => {
  if (employee?.status === 'exited') {
    throw new BusinessRuleError(
      `employee ${employee.code} has left the company; custody can only be handed to a current employee`,
    );
  }
};

/**
 * Only an asset in stock is handed over — the one message for assign, hand-over and the receipt
 * printed before either, so the paper is refused for exactly what the hand-over would refuse.
 */
export const refuseUnlessInStock = async (
  asset: ItAssetDoc,
  session?: Parameters<Parameters<typeof unitOfWork>[0]>[0],
): Promise<void> => {
  if (asset.status === 'inStock') return;
  const open = await itAssetAssignmentRepository.findOpenForAsset(String(asset._id), session);
  throw new ConflictError(
    open === null
      ? `asset ${asset.assetCode} is ${asset.status} and cannot be assigned`
      : `asset ${asset.assetCode} is already assigned; return or transfer it first`,
  );
};

/**
 * The audit row for a receipt (FR-18): who signed for which assets — and, on a department custody
 * paper, the department and the place they signed for (`employeeId` is then the signer).
 */
export const receiptIssuedAudit = (
  receiptId: Types.ObjectId,
  employeeId: string,
  assetCodes: readonly string[],
  custodian: DepartmentHolder | null = null,
): AuditEntry => ({
  entityRef: { moduleId: 'it', entityType: 'custodyReceipt', entityId: String(receiptId) },
  action: 'create',
  changes: [
    change('employeeId', null, employeeId),
    ...(custodian === null
      ? []
      : [
          change('departmentId', null, custodian.departmentId),
          change('locationId', null, custodian.locationId),
        ]),
    change('assets', null, [...assetCodes]),
  ],
});

/**
 * The audit row for a receipt (FR-18), written by the hand-over that wrote the receipt. A transfer
 * to a new holder writes its receipt's row after its commit instead (`transferInSession`).
 */
export const auditReceiptIssued = async (
  receiptId: Types.ObjectId,
  employeeId: string,
  assetCodes: readonly string[],
  custodian: DepartmentHolder | null = null,
): Promise<void> => {
  await auditService.record(receiptIssuedAudit(receiptId, employeeId, assetCodes, custodian));
};

/**
 * Who a hand-over names, read before its transaction: the paper's signer as HR answers for them,
 * and — for a department — the department and the place (`readCustodian`, with its refusals). An
 * employee who has left is refused custody of their own; a department's responsible person who has
 * left is refused the signature (`readCustodian`).
 */
export const readHandOverHolder = async (input: {
  employeeId?: string | undefined;
  department?: HandOverItAssets['department'];
}): Promise<{ holder: CustodyHolder; signer: ReceiptHolder; custodian: CustodianRead | null }> => {
  if (input.department !== undefined && input.employeeId === undefined) {
    const custodian = await readCustodian(input.department);
    return { holder: custodian.holder, signer: custodian.signer, custodian };
  }
  const holder = holderOfRequest(input);
  const signer = await readReceiptHolder(signerOf(holder));
  refuseLeaver(signer.employee);
  return { holder, signer, custodian: null };
};

/** A holder's fields on a custody event — the department's ids, or nulls for an employee. */
const eventHolderFields = (holder: CustodyHolder) =>
  holder.kind === 'employee'
    ? { employeeId: holder.employeeId }
    : {
        employeeId: null,
        holderKind: 'department' as const,
        departmentId: holder.departmentId,
        locationId: holder.locationId,
        responsibleEmployeeId: holder.responsibleEmployeeId,
      };

/** The receipt's snapshot of who signed it — taken from the holder read before the transaction. */
export const signer = (holder: ReceiptHolder) => ({
  employeeCode: holder.employeeCode,
  employeeName: holder.employeeName,
  jobTitle: holder.jobTitle,
  nationalId: holder.nationalId,
  section: holder.section,
  department: holder.department,
});

interface HistoryInput {
  assetId: string;
  type: ItAssetEventType;
  at: Date;
  metadata: Record<string, unknown>;
  notes: string | null;
}

/** What a transfer reads before its transaction — and keeps across a retry of it. */
interface TransferPreparation {
  /**
   * The person the transfer names, as HR answers for them — the new employee holder, or the
   * responsible person who signs for a new department holder; null when it names nobody.
   */
  named: ReceiptHolder | null;
  /** The department and place the transfer names (`toDepartment`), read and judged; or null. */
  custodian: CustodianRead | null;
  /** What the new holder's paper calls the device; empty when no paper is printed. */
  deviceTypes: ReadonlyMap<string, string>;
  /** The new holder's paper number, once taken — kept so a retried transaction takes no second. */
  formNumber: number | null;
}

/** One transfer, as the transaction runs it. */
interface TransferStep {
  assetId: string;
  input: TransferItAsset;
  /** When it happened — fixed before the transaction, so a retry records the same instant. */
  at: Date;
  prepared: TransferPreparation;
  /**
   * «نقل إلى فرع» — the move's own part of it: the place the asset had inside the branch it leaves
   * is cleared, and the move's notes go on the `transferred` entry alone. They never become the
   * interval's: the holder's custody is the one they already signed for, notes and all.
   */
  move?: { notes: string | null };
}

/** What a transfer wrote — and what its caller writes once the transaction has committed. */
interface TransferOutcome {
  asset: ItAssetDoc;
  assignment: ItAssetAssignmentDoc;
  fromBranchId: string;
  /** The employee who holds it after the transfer; null when a department does. */
  holderEmployeeId: string | null;
  /** In order: the new holder's receipt (when there is one), then the transfer. */
  audits: AuditEntry[];
  event: ItAssetTransferredPayload;
}

/** One asset of a move to another branch, as the commit leaves it to be audited and announced. */
interface MoveOutcome {
  assetCode: string;
  fromBranchId: string;
  holderEmployeeId: string | null;
  audits: AuditEntry[];
  event: ItAssetTransferredPayload;
}

class ItAssetCustodyService {
  /**
   * Load the asset for a custody transition and refuse the states that admit none.
   *
   * `disposed` is terminal (FR-4) and is rejected here for every action, including dispose itself —
   * disposing twice would overwrite the first disposal's reason and date, which is precisely the
   * record disposal exists to keep.
   */
  private async loadForTransition(
    assetId: string,
    scope: ScopeSelector,
    session: Parameters<Parameters<typeof unitOfWork>[0]>[0],
  ): Promise<ItAssetDoc> {
    const asset = await itAssetRepository.getByIdForUpdate(assetId, scope, session);
    if (asset.status === 'disposed') {
      throw new BusinessRuleError(
        `asset ${asset.assetCode} is disposed; a disposed asset accepts no further custody operation (FR-4)`,
      );
    }
    return asset;
  }

  /**
   * IT-4: an asset under an ACTIVE maintenance order does not move (design §2.7).
   *
   * `return`, `transfer` and `dispose` each write a custody fact that contradicts an order still in
   * hand — the technician holds the machine, so it cannot also be handed back, handed on, or
   * written off. `assign` is deliberately NOT guarded: an in-stock asset with an open order is a
   * machine waiting for a repair, and issuing it to its user is a decision this guard has no
   * business refusing. Starting the work is what actually takes it out of service, and the order
   * service guards that direction itself.
   *
   * The check runs INSIDE the caller's transaction. Outside it, a concurrent `start` could commit
   * between the check and the write, and the guard would pass on a fact that had already changed.
   */
  private async assertNoActiveMaintenance(
    asset: ItAssetDoc,
    action: string,
    session: Parameters<Parameters<typeof unitOfWork>[0]>[0],
  ): Promise<void> {
    const blocked = await itMaintenanceOrderRepository.hasActiveForAsset(
      String(asset._id),
      session,
    );
    if (blocked) {
      throw new ConflictError(
        `asset ${asset.assetCode} is under an open maintenance order; complete or cancel it before you ${action} the asset`,
      );
    }
  }

  private async writeHistory(
    input: HistoryInput,
    ctx: AuthContext,
    session: Parameters<Parameters<typeof unitOfWork>[0]>[0],
  ): Promise<void> {
    await itAssetEventRepository.append(
      {
        subjectId: new Types.ObjectId(input.assetId),
        type: input.type,
        at: input.at,
        actorUserId: new Types.ObjectId(ctx.userId),
        actorName: actorNameOf(ctx),
        metadata: input.metadata,
        notes: input.notes,
      },
      { by: ctx.userId, session },
    );
  }

  /**
   * Assign ONE asset — the single-line hand-over. Kept as its own endpoint for the callers that
   * already use it; it opens the same receipt every hand-over does (FR-18), so no interval is ever
   * opened for a person without the paper they sign for it.
   */
  async assign(
    assetId: string,
    input: AssignItAsset,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<{ asset: ItAssetDoc; assignment: ItAssetAssignmentDoc }> {
    const { assets, assignments } = await this.handOver(
      {
        ...(input.employeeId === undefined ? {} : { employeeId: input.employeeId }),
        ...(input.department === undefined ? {} : { department: input.department }),
        lines: [
          {
            assetId,
            ...(input.conditionOnIssue === undefined
              ? {}
              : { conditionOnIssue: input.conditionOnIssue }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
          },
        ],
        ...(input.assignedAt === undefined ? {} : { assignedAt: input.assignedAt }),
        ...(input.expectedReturnAt === undefined
          ? {}
          : { expectedReturnAt: input.expectedReturnAt }),
      },
      ctx,
      scope,
    );
    const [asset] = assets;
    const [assignment] = assignments;
    if (asset === undefined || assignment === undefined) {
      throw new NotFoundError('the hand-over recorded nothing');
    }
    return { asset, assignment };
  }

  /**
   * Hand-over (FR-18): one employee, one or more assets, ONE receipt — «إيصال استلام».
   *
   * Every line is an assign in its own right (the asset must be in stock, design §2.5) and writes
   * what an assign always wrote — the interval, the asset's denormalization, an `assigned` history
   * event, an audit row and, after the commit, the platform event. They share one transaction with
   * the receipt: the paper lists exactly the intervals the system opened, and a line refused
   * half-way through leaves nothing behind — neither the lines before it nor the receipt.
   *
   * Or one DEPARTMENT at one place (2026-11-19) — «في عهدة إدارة …»: the intervals are the
   * department's, and the paper is signed by its responsible person. Every asset must then be in
   * the place's branch (`OTHER_BRANCH`, naming each one that is not), so the paper lists one
   * branch's assets; every line is read and judged before anything is written.
   */
  async handOver(
    input: HandOverItAssets,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<{
    receipt: ItCustodyReceiptDoc;
    assets: ItAssetDoc[];
    assignments: ItAssetAssignmentDoc[];
  }> {
    const at = input.assignedAt ?? new Date();
    // Asked BEFORE the transaction: HR's answer is not part of the custody write, and a read of
    // another module's data has no business holding it open. The department and the place too.
    const { holder: requested, signer: holder, custodian } = await readHandOverHolder(input);
    const signerId = signerOf(requested);
    // What the paper calls each device — reference data, read before the transaction like the
    // holder.
    const deviceTypes = await readDeviceTypesOf(input.lines.map((line) => line.assetId));
    await itCustodyReceiptRepository.ensureCollection();
    // The number on the paper that was printed for this hand-over — or the next one, for a caller
    // that printed nothing. Outside the transaction, so a retry of it never takes a second number.
    const formNumber = await receiptNumberFor(input.formNumber);
    // Allocated up front so each interval can name its receipt as it is created.
    const receiptId = new Types.ObjectId();

    const result = await unitOfWork(async (session) => {
      // The paper's number first — before anything this attempt audits: a number another paper
      // already records refuses the hand-over, and a race on it retries, before any write.
      await claimReceiptNumber(formNumber, session);
      const assets: ItAssetDoc[] = [];
      const assignments: ItAssetAssignmentDoc[] = [];
      const lines: ItCustodyReceiptLineSub[] = [];

      // Every line read and judged first — in stock, and for a department in the place's branch —
      // so a refusal names every asset holding the paper back and nothing is written before it.
      const loaded: ItAssetDoc[] = [];
      for (const line of input.lines) {
        const asset = await this.loadForTransition(line.assetId, scope, session);
        await refuseUnlessInStock(asset, session);
        loaded.push(asset);
      }
      if (custodian !== null) refuseOutsidePlaceBranch(custodian, loaded);

      for (const [index, line] of input.lines.entries()) {
        const asset = loaded[index];
        if (asset === undefined) throw new NotFoundError('asset not found');

        const assignment = await itAssetAssignmentRepository.create(
          {
            assetId: new Types.ObjectId(line.assetId),
            ...intervalHolderFields(requested),
            assignedByUserId: new Types.ObjectId(ctx.userId),
            assignedAt: at,
            conditionOnIssue: line.conditionOnIssue ?? null,
            expectedReturnAt: input.expectedReturnAt ?? null,
            returnedAt: null,
            returnedToUserId: null,
            conditionOnReturn: null,
            notes: line.notes ?? null,
            branchId: asset.branchId,
            receiptId,
          },
          { by: ctx.userId, session },
        );

        const updated = await itAssetRepository.updateById(
          line.assetId,
          { status: 'assigned', currentAssignmentId: assignment._id },
          { by: ctx.userId, version: asset.__v, session, scope },
        );

        await this.writeHistory(
          {
            assetId: line.assetId,
            type: 'assigned',
            at,
            metadata: {
              assignmentId: String(assignment._id),
              ...holderHistory(requested),
              receiptId: String(receiptId),
              ...(input.expectedReturnAt === undefined
                ? {}
                : { expectedReturnAt: input.expectedReturnAt.toISOString() }),
              ...(line.conditionOnIssue === undefined
                ? {}
                : { conditionOnIssue: line.conditionOnIssue }),
            },
            notes: line.notes ?? null,
          },
          ctx,
          session,
        );

        await auditService.record({
          entityRef: entityRef(line.assetId),
          action: 'assign',
          changes: [
            change('status', asset.status, 'assigned'),
            ...holderAuditChanges(null, requested),
          ],
        });

        assets.push(updated);
        assignments.push(assignment);
        lines.push({
          assetId: asset._id,
          assignmentId: assignment._id,
          assetCode: asset.assetCode,
          name: asset.name,
          serialNumber: asset.serialNumber,
          conditionOnIssue: line.conditionOnIssue ?? null,
          notes: line.notes ?? null,
          ...receiptDeviceFields(asset, deviceTypes, line.accessories),
        });
      }

      const [first] = assets;
      if (first === undefined) throw new BusinessRuleError('a receipt lists at least one asset');
      const receipt = await itCustodyReceiptRepository.create(
        {
          _id: receiptId,
          formNumber,
          employeeId: new Types.ObjectId(signerId),
          ...signer(holder),
          issuedAt: at,
          issuedByUserId: new Types.ObjectId(ctx.userId),
          // A department paper's branch is the place's — every line's too (checked above).
          branchId:
            custodian === null ? first.branchId : new Types.ObjectId(custodian.locationBranchId),
          lines,
          signedCopy: null,
          custodian: custodian === null ? null : custodianSnapshot(custodian),
        },
        { by: ctx.userId, session },
      );
      await auditReceiptIssued(
        receiptId,
        signerId,
        lines.map((line) => line.assetCode),
        custodian?.holder ?? null,
      );

      return { receipt, assets, assignments };
    });

    for (const [index, asset] of result.assets.entries()) {
      await emit(ItEvents.AssetAssigned, {
        assetId: String(asset._id),
        assetCode: asset.assetCode,
        ...eventHolderFields(requested),
        assignmentId: String(result.assignments[index]?._id),
      });
    }
    return result;
  }

  /** Return: closes the open interval and puts the asset back in stock. */
  async returnAsset(
    assetId: string,
    input: ReturnItAsset,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<{ asset: ItAssetDoc; assignment: ItAssetAssignmentDoc }> {
    const at = input.returnedAt ?? new Date();
    const result = await unitOfWork(async (session) => {
      const asset = await this.loadForTransition(assetId, scope, session);
      await this.assertNoActiveMaintenance(asset, 'return', session);
      const open = await itAssetAssignmentRepository.findOpenForAsset(assetId, session);
      if (open === null) {
        throw new ConflictError(`asset ${asset.assetCode} is not currently assigned to anyone`);
      }
      if (at.getTime() < open.assignedAt.getTime()) {
        throw new BusinessRuleError('the return cannot precede the assignment it closes');
      }

      const closed = await itAssetAssignmentRepository.updateById(
        String(open._id),
        {
          returnedAt: at,
          returnedToUserId: new Types.ObjectId(ctx.userId),
          conditionOnReturn: input.conditionOnReturn ?? null,
        },
        { by: ctx.userId, version: open.__v, session },
      );

      const updated = await itAssetRepository.updateById(
        assetId,
        { status: 'inStock', currentAssignmentId: null },
        { by: ctx.userId, version: asset.__v, session, scope },
      );

      // Given back by whoever held it — an employee or a department; a return is always allowed.
      const holder = holderOfInterval(open);
      await this.writeHistory(
        {
          assetId,
          type: 'returned',
          at,
          metadata: {
            assignmentId: String(open._id),
            ...holderHistory(holder),
            ...(input.conditionOnReturn === undefined
              ? {}
              : { conditionOnReturn: input.conditionOnReturn }),
          },
          notes: input.notes ?? null,
        },
        ctx,
        session,
      );

      await auditService.record({
        entityRef: entityRef(assetId),
        action: 'return',
        changes: [change('status', asset.status, 'inStock'), ...holderAuditChanges(holder, null)],
      });

      return { asset: updated, assignment: closed, holder };
    });

    await emit(ItEvents.AssetReturned, {
      assetId,
      assetCode: result.asset.assetCode,
      ...eventHolderFields(result.holder),
      condition: input.conditionOnReturn ?? null,
    });
    return { asset: result.asset, assignment: result.assignment };
  }

  /**
   * What a transfer reads BEFORE its transaction, once: HR's answer about the holder it names (read
   * outside, like assign's, and judged inside — whether that holder is NEW is only known once the
   * open interval has been read; the same read names them on the receipt a hand-over to them
   * prints, FR-18) and what that paper calls the device. A transfer naming nobody new — the move to
   * another branch in the same hands — asks HR nothing.
   */
  private async prepareTransfer(
    assetId: string,
    input: TransferItAsset,
  ): Promise<TransferPreparation> {
    // A department is always a NEW holder (the same department, place and signer in another
    // branch is a place that does not travel), so its refusals — a signer who left, a department
    // or a place that is not live — are said here, before anything else is asked.
    const custodian =
      input.toDepartment === undefined
        ? null
        : await readCustodian(input.toDepartment, 'body.toDepartment');
    const named =
      custodian !== null
        ? custodian.signer
        : input.toEmployeeId === undefined
          ? null
          : await readReceiptHolder(input.toEmployeeId);
    const deviceTypes =
      named === null ? new Map<string, string>() : await readDeviceTypesOf([assetId]);
    if (named !== null) await itCustodyReceiptRepository.ensureCollection();
    return { named, custodian, deviceTypes, formNumber: null };
  }

  /**
   * The transfer's body, inside a transaction the CALLER owns — custody's own `transfer` (one
   * asset, its own transaction) and «نقل إلى فرع» (`moveToBranch`: many assets, one transaction,
   * all of them or none) write a held asset's transfer through this one path, so the move of a held
   * asset IS the custody transfer to a new branch in the same hands, not a copy of it.
   *
   * It writes and audits nothing outside the session: the audit rows and the platform event come
   * back in the outcome, for the caller to write once the transaction has committed — the audit
   * service is not part of the transaction, so a row written inside it would outlive a transfer the
   * database then refused (a later asset of the same move, say), and a retried transaction would
   * write it twice.
   */
  private async transferInSession(
    step: TransferStep,
    ctx: AuthContext,
    scope: ScopeSelector,
    session: Parameters<Parameters<typeof unitOfWork>[0]>[0],
  ): Promise<TransferOutcome> {
    const { assetId, input, at, prepared } = step;
    const named = prepared.named;
    const asset = await this.loadForTransition(assetId, scope, session);
    // Compared — and stored — as an id is spelled: `objectId()` admits upper-case hex, and an
    // upper-case copy of the asset's own branch is that branch, not a move to another.
    const toBranchId = (input.toBranchId ?? String(asset.branchId)).toLowerCase();
    const sameBranch = toBranchId === String(asset.branchId);
    // A single asset's «نقل» to ANOTHER branch goes only where «نقل إلى فرع» may (2026-11-18): a
    // live branch the caller's `itAsset.assign` reaches whole — so a branch keeper can no longer
    // send a device into a branch they cannot see, where it would vanish from their register. The
    // same branch, or none named, asks nothing. The move judged its one target before its own
    // transaction, for all its assets at once.
    if (!sameBranch && step.move === undefined) await this.assertBranchTarget(ctx, toBranchId);
    await this.assertNoActiveMaintenance(asset, 'transfer', session);
    const open = await itAssetAssignmentRepository.findOpenForAsset(assetId, session);
    if (open === null) {
      throw new ConflictError(
        `asset ${asset.assetCode} is not currently assigned; assign it rather than transferring it`,
      );
    }
    if (at.getTime() < open.assignedAt.getTime()) {
      throw new BusinessRuleError('the transfer cannot precede the assignment it closes');
    }

    const current = holderOfInterval(open);
    const custodian = prepared.custodian;
    // The new holder: the employee named, the department named, or — naming neither — the same.
    const next: CustodyHolder =
      custodian !== null
        ? custodian.holder
        : input.toEmployeeId !== undefined
          ? { kind: 'employee', employeeId: input.toEmployeeId.toLowerCase() }
          : current;
    // A department keeps the asset at a place in the asset's branch, and a place does not travel:
    // moving it to another branch names who holds it there — a place there, or an employee.
    if (current.kind === 'department' && next === current && !sameBranch) {
      throw new BusinessRuleError(
        `asset ${asset.assetCode} is held by a department at a place in its branch; name a place in the new branch, or an employee`,
      );
    }
    if (custodian !== null && custodian.locationBranchId !== toBranchId) {
      throw custodianRefusal(
        'body.toDepartment.locationId',
        'OTHER_BRANCH',
        `the place must be in the branch asset ${asset.assetCode} is held in after the transfer`,
      );
    }
    // A department is the same holder only with the same place and the same signer: a move to
    // another room, or the department signing again after its responsible person left, is a new
    // holder — a new paper, nothing carried over.
    const sameHolder = isSameHolder(current, next);
    if (sameHolder && sameBranch) {
      throw new BusinessRuleError(
        'a transfer must change the holder, the branch, or both — this changes neither',
      );
    }
    // Only a transfer that HANDS the asset to somebody new is a hand-over. Moving it across
    // branches in the same hands gives nobody anything, even when those hands have since left:
    // the return is still owed, and refusing the move would not bring it any closer. (A
    // department's signer was judged when it was read, `readCustodian`.)
    if (!sameHolder && next.kind === 'employee') refuseLeaver(named?.employee ?? null);
    const signerId = signerOf(next);
    // A new holder signs a new receipt (FR-18); the same holder moving branch is still bound by
    // the paper they already signed, so the next interval carries it over.
    const receiptId = sameHolder ? (open.receiptId ?? null) : new Types.ObjectId();
    // …and the custody they signed for is the same custody: the next interval CARRIES its due
    // date, the condition it was handed over in and its notes, unless the transfer gives its own —
    // a same-hands move must not quietly forget when the asset is due back. A NEW holder's interval
    // is theirs, from the request alone. The move to another branch never gives any (`step.move`).
    const carried = sameHolder ? open : null;
    const audits: AuditEntry[] = [];

    // Close the current interval. `returnedAt` is what makes it closed, so the partial unique
    // index releases immediately and the new interval can be inserted in the same transaction.
    await itAssetAssignmentRepository.updateById(
      String(open._id),
      {
        returnedAt: at,
        returnedToUserId: new Types.ObjectId(ctx.userId),
        conditionOnReturn: input.conditionOnReturn ?? null,
      },
      { by: ctx.userId, version: open.__v, session },
    );

    const opened = await itAssetAssignmentRepository.create(
      {
        assetId: new Types.ObjectId(assetId),
        ...intervalHolderFields(next),
        assignedByUserId: new Types.ObjectId(ctx.userId),
        assignedAt: at,
        conditionOnIssue: input.conditionOnIssue ?? carried?.conditionOnIssue ?? null,
        expectedReturnAt: input.expectedReturnAt ?? carried?.expectedReturnAt ?? null,
        returnedAt: null,
        returnedToUserId: null,
        conditionOnReturn: null,
        notes: input.notes ?? carried?.notes ?? null,
        branchId: new Types.ObjectId(toBranchId),
        receiptId,
      },
      { by: ctx.userId, session },
    );

    if (!sameHolder && receiptId !== null && named !== null) {
      // Taken only once the transfer is known to hand the asset to somebody new, and kept on the
      // preparation across a retry of the transaction, so a retry never takes a second number.
      prepared.formNumber ??= await receiptNumberFor(input.formNumber);
      await claimReceiptNumber(prepared.formNumber, session);
      await itCustodyReceiptRepository.create(
        {
          _id: receiptId,
          formNumber: prepared.formNumber,
          employeeId: new Types.ObjectId(signerId),
          ...signer(named),
          issuedAt: at,
          issuedByUserId: new Types.ObjectId(ctx.userId),
          branchId: new Types.ObjectId(toBranchId),
          lines: [
            {
              assetId: asset._id,
              assignmentId: opened._id,
              assetCode: asset.assetCode,
              name: asset.name,
              serialNumber: asset.serialNumber,
              conditionOnIssue: input.conditionOnIssue ?? null,
              notes: input.notes ?? null,
              ...receiptDeviceFields(asset, prepared.deviceTypes),
            },
          ],
          signedCopy: null,
          custodian: custodian === null ? null : custodianSnapshot(custodian),
        },
        { by: ctx.userId, session },
      );
      audits.push(
        receiptIssuedAudit(receiptId, signerId, [asset.assetCode], custodian?.holder ?? null),
      );
    }

    // The move to another branch also leaves behind the place the asset had inside the branch it
    // left — the head office's «مخزن IT» is no place in Tanta (the go-live's branch step's rule).
    const clearsLocation = step.move !== undefined && !sameBranch;
    const location = asset.location ?? null;
    // `branchId` is the asset's data-scope anchor and the design says it changes ONLY by a
    // transfer — this one, or the move of an asset in stock (`moveToBranch`).
    const updated = await itAssetRepository.updateById(
      assetId,
      {
        status: 'assigned',
        currentAssignmentId: opened._id,
        branchId: new Types.ObjectId(toBranchId),
        ...(clearsLocation ? { location: null } : {}),
      },
      { by: ctx.userId, version: asset.__v, session, scope },
    );

    await this.writeHistory(
      {
        assetId,
        type: 'transferred',
        at,
        metadata: {
          // An employee's `fromEmployeeId` / `toEmployeeId`, as every reader knows them; a
          // department's `from…` / `to…` department, place and signer.
          ...holderHistory(current, 'from'),
          ...holderHistory(next, 'to'),
          fromBranchId: String(asset.branchId),
          toBranchId,
          assignmentId: String(opened._id),
          ...(receiptId === null ? {} : { receiptId: String(receiptId) }),
        },
        // The move's notes are the move's: here, and not on the interval it opens.
        notes: step.move === undefined ? (input.notes ?? null) : step.move.notes,
      },
      ctx,
      session,
    );

    audits.push({
      entityRef: entityRef(assetId),
      action: 'transfer',
      changes: [
        ...holderAuditChanges(current, next),
        change('branchId', String(asset.branchId), toBranchId),
        ...(clearsLocation && location !== null ? [change('location', location, null)] : []),
      ],
    });

    return {
      asset: updated,
      assignment: opened,
      fromBranchId: String(asset.branchId),
      holderEmployeeId: employeeHolderId(next),
      audits,
      event: {
        assetId,
        assetCode: asset.assetCode,
        fromEmployeeId: employeeHolderId(current),
        toEmployeeId: employeeHolderId(next),
        fromBranchId: String(asset.branchId),
        toBranchId,
        // A department before or after — absent from an employee-to-employee transfer, as before.
        ...(current.kind === 'department' || next.kind === 'department'
          ? {
              fromDepartmentId: current.kind === 'department' ? current.departmentId : null,
              toDepartmentId: next.kind === 'department' ? next.departmentId : null,
              fromLocationId: current.kind === 'department' ? current.locationId : null,
              toLocationId: next.kind === 'department' ? next.locationId : null,
            }
          : {}),
      },
    };
  }

  /**
   * Transfer: ONE fact, not two (design §2.5).
   *
   * Person→person, branch→branch, or both — and since 2026-11-19 a department at a place on either
   * side: department → employee, employee → department, a move to another room, or the department
   * signing again with a new responsible person. It closes the current interval and opens the next
   * inside a single transaction and writes a single `transferred` event — never return+assign,
   * because read back later the two would be indistinguishable from an unrelated same-day
   * return and reissue, and the history has to show intent. A new branch must be one «نقل إلى
   * فرع» could send it to (`assertBranchTarget`); a new holder may work in any branch.
   */
  async transfer(
    assetId: string,
    input: TransferItAsset,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<{ asset: ItAssetDoc; assignment: ItAssetAssignmentDoc }> {
    const at = input.at ?? new Date();
    const prepared = await this.prepareTransfer(assetId, input);
    const result = await unitOfWork((session) =>
      this.transferInSession({ assetId, input, at, prepared }, ctx, scope, session),
    );

    // After the commit: the receipt's row (a new holder's), then the transfer's, then the event.
    for (const entry of result.audits) await auditService.record(entry);
    await emit(ItEvents.AssetTransferred, result.event);
    return { asset: result.asset, assignment: result.assignment };
  }

  /**
   * The branch an asset is sent to — by «نقل إلى فرع», or by a single asset's «نقل» to another
   * branch — must be a live one the caller's `itAsset.assign` reaches as a whole: the test
   * `moveTargets` lists by, so a dialog built from that list offers nothing refused here. 403 for a
   * branch the grant does not reach; 400 for one unknown or inactive.
   */
  private async assertBranchTarget(ctx: AuthContext, toBranchId: string): Promise<void> {
    if (!keyReachesBranch(ctx, 'itAsset.assign', toBranchId)) {
      throw new ForbiddenError('itAsset.assign does not reach this branch');
    }
    const branch = await branchRepository.findById(toBranchId);
    if (branch === null || branch.status !== 'active') {
      throw new ValidationError([
        { field: 'body.toBranchId', code: 'UNKNOWN', message: 'branch not found or inactive' },
      ]);
    }
  }

  /**
   * Where «نقل إلى فرع» may go for this caller: every active branch of the organisation their
   * `itAsset.assign` reaches as a whole (`moveTargetBranchIds`). The same branch list and the same
   * test `moveToBranch` applies to the branch it is given, so a picker built from it offers nothing
   * the move would refuse. In the branch options' order (by code). The consumables' «تحويل إلى
   * فرع» asks the same rule of its own grant (`GET /it/consumables/transfer-targets`). A single
   * asset's «نقل» to another branch is held to the same list (2026-11-18).
   */
  async moveTargets(ctx: AuthContext): Promise<ItMoveTargetsDto> {
    const branches = await branchRepository.listAll();
    return {
      branchIds: moveTargetBranchIds(
        ctx,
        'itAsset.assign',
        branches.map((branch) => ({ id: String(branch._id), status: branch.status })),
      ),
    };
  }

  /**
   * «نقل إلى فرع» — «عايز إمكانية نقل أصل … إلى فرع تاني»: every asset named, to ONE branch, at once
   * («فوراً» — no «in transit», nothing to confirm at the other end) and with no paper («لا، السجل
   * كفاية» — the history is the record), in ONE transaction: all of them move, or none does.
   *
   *   · in stock → its branch is the target's, and its `location` is cleared — a location names a
   *     place inside the branch it left; one `transferred` entry naming the two branches and nobody;
   *   · held → «ينتقل مع عهدته»: exactly the custody transfer to a new branch in the same hands
   *     (`transferInSession`) — the open interval closed, the next opened in the new branch for the
   *     same holder on the receipt they already signed, its due date, condition and notes carried
   *     over — its location cleared the same way, and the move's notes on its history entry alone.
   *     The holder is not refused for having left: a same-hands move hands nobody anything.
   *
   * Every asset is read under the caller's `itAsset.assign` scope — one they cannot see is a 404
   * for the whole request — and the target must be a live branch their `itAsset.assign` reaches.
   * Refused, naming every asset that holds the move back (`assetMoveRefusalError`): a disposed
   * asset, one under maintenance (its status, or an open order), one already there, one a
   * DEPARTMENT holds at a place in its branch (moved with «نقل» to a place in the new branch, or
   * returned first), a held one whose custody began after the move's date. Each write is conditional on the version read in the
   * same transaction, so a concurrent edit rolls the whole move back. The audit rows and the events
   * follow the commit, in the order the request named the assets.
   */
  async moveToBranch(
    input: MoveItAssetsToBranch,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItAssetsBranchMoveResultDto> {
    // An id as the database spells it, once, and only this from here on: `objectId()` admits
    // upper-case hex, and an upper-case copy of an asset's own branch must read as «already there»
    // — not slip past it and write a move from a branch to itself.
    const toBranchId = input.toBranchId.toLowerCase();
    await this.assertBranchTarget(ctx, toBranchId);
    const at = input.at ?? new Date();
    const notes = input.notes ?? null;
    // Nobody new is named, so a held asset's transfer asks HR nothing and prints no paper: one
    // preparation does for every asset of the move.
    const prepared: TransferPreparation = {
      named: null,
      custodian: null,
      deviceTypes: new Map(),
      formNumber: null,
    };

    const done = await unitOfWork(async (session) => {
      // 1. Every asset, under the caller's scope and in this transaction — any one missing is the
      //    request's 404 — and every refusal at once, before anything is written.
      const assets: ItAssetDoc[] = [];
      for (const assetId of input.assetIds) {
        assets.push(await itAssetRepository.getByIdForUpdate(assetId, scope, session));
      }
      const refused: { assetCode: string; reason: AssetMoveRefusal }[] = [];
      for (const asset of assets) {
        const assetId = String(asset._id);
        // A held asset's open interval, read here so a move dated before it began is refused with
        // the others, naming the asset — `transferInSession` still guards it, one asset at a time.
        const open =
          asset.status === 'assigned'
            ? await itAssetAssignmentRepository.findOpenForAsset(assetId, session)
            : null;
        const reason = assetMoveRefusal(
          {
            status: asset.status,
            branchId: String(asset.branchId),
            activeMaintenance:
              asset.status !== 'disposed' &&
              (await itMaintenanceOrderRepository.hasActiveForAsset(assetId, session)),
            heldSince: open?.assignedAt ?? null,
            // A department keeps it at a place in this branch, and a place does not move with it.
            heldByDepartment: (open?.holderKind ?? 'employee') === 'department',
          },
          toBranchId,
          at,
        );
        if (reason !== null) refused.push({ assetCode: asset.assetCode, reason });
      }
      const refusal = assetMoveRefusalError(refused);
      if (refusal !== null) throw refusal;

      // 2. Each asset as its state says, in request order.
      const outcomes: MoveOutcome[] = [];
      for (const asset of assets) {
        const assetId = String(asset._id);
        if (asset.status === 'assigned') {
          const outcome = await this.transferInSession(
            // The branch alone: the move names no custody fact, so the holder's stay as they are.
            { assetId, input: { toBranchId }, at, prepared, move: { notes } },
            ctx,
            scope,
            session,
          );
          outcomes.push({
            assetCode: asset.assetCode,
            fromBranchId: outcome.fromBranchId,
            holderEmployeeId: outcome.holderEmployeeId,
            audits: outcome.audits,
            event: outcome.event,
          });
          continue;
        }

        const fromBranchId = String(asset.branchId);
        const location = asset.location ?? null;
        await itAssetRepository.updateById(
          assetId,
          { branchId: new Types.ObjectId(toBranchId), location: null },
          { by: ctx.userId, version: asset.__v, session, scope },
        );
        // A branch-only transfer: no employee keys — the history list and the dashboard already
        // read such an entry as the two branches and nobody (the go-live's branch step writes it).
        await this.writeHistory(
          {
            assetId,
            type: 'transferred',
            at,
            metadata: { fromBranchId, toBranchId },
            notes,
          },
          ctx,
          session,
        );
        outcomes.push({
          assetCode: asset.assetCode,
          fromBranchId,
          holderEmployeeId: null,
          audits: [
            {
              entityRef: entityRef(assetId),
              action: 'transfer',
              changes: [
                change('branchId', fromBranchId, toBranchId),
                ...(location === null ? [] : [change('location', location, null)]),
              ],
            },
          ],
          event: {
            assetId,
            assetCode: asset.assetCode,
            fromEmployeeId: null,
            toEmployeeId: null,
            fromBranchId,
            toBranchId,
          },
        });
      }
      return outcomes;
    });

    // After the commit, in request order: the trail (and through it the refresh of anybody looking
    // at the register), then the platform's events.
    await auditService.recordMany(done.flatMap((outcome) => outcome.audits));
    for (const outcome of done) await emit(ItEvents.AssetTransferred, outcome.event);
    return assetsBranchMoveResult(
      toBranchId,
      done.map((outcome) => ({
        assetId: outcome.event.assetId,
        assetCode: outcome.assetCode,
        fromBranchId: outcome.fromBranchId,
        toBranchId,
        holderEmployeeId: outcome.holderEmployeeId,
      })),
    );
  }

  /**
   * Dispose: terminal, set once (FR-4).
   *
   * Requires no open assignment — writing off an asset someone still holds would record a
   * disposal that did not happen and lose the custody thread at the moment it matters most.
   */
  async dispose(
    assetId: string,
    input: DisposeItAsset,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItAssetDoc> {
    const at = input.at ?? new Date();
    const asset = await unitOfWork(async (session) => {
      const current = await this.loadForTransition(assetId, scope, session);
      await this.assertNoActiveMaintenance(current, 'dispose', session);
      const open = await itAssetAssignmentRepository.findOpenForAsset(assetId, session);
      if (open !== null) {
        throw new ConflictError(
          `asset ${current.assetCode} is still assigned; record its return before disposing of it (FR-4)`,
        );
      }

      const updated = await itAssetRepository.updateById(
        assetId,
        {
          status: 'disposed',
          currentAssignmentId: null,
          disposal: {
            at,
            method: input.method,
            reason: input.reason,
            notes: input.notes ?? null,
          },
        },
        { by: ctx.userId, version: current.__v, session, scope },
      );

      await this.writeHistory(
        {
          assetId,
          type: 'disposed',
          at,
          metadata: { method: input.method, reason: input.reason },
          notes: input.notes ?? null,
        },
        ctx,
        session,
      );

      await auditService.record({
        entityRef: entityRef(assetId),
        action: 'dispose',
        changes: [
          change('status', current.status, 'disposed'),
          change('disposal.method', null, input.method),
        ],
      });

      return updated;
    });

    await emit(ItEvents.AssetDisposed, {
      assetId,
      assetCode: asset.assetCode,
      method: input.method,
      reason: input.reason,
    });
    return asset;
  }

  /**
   * `hr.employee.exited` (design §9.1, FR-13).
   *
   * The leaver's open assignments are RECORDED, never auto-returned. A physical return is a thing
   * a human witnesses; writing one because HR closed a record would put a custody fact in the
   * chain that never happened — and this chain is what settles disputes. The exit checklist is the
   * process; this is its safety net.
   *
   * The notification half of §9.1 needs the module's templates, which are IT-6. Until then the
   * fact is recorded in the audit trail (`alertRaised`, an existing action) and logged, so nothing
   * is silently dropped in the meantime.
   */
  async flagAssetsHeldByExitedEmployee(employeeId: string): Promise<number> {
    const [open, signed] = await Promise.all([
      itAssetAssignmentRepository.listOpenForEmployee(employeeId),
      itAssetAssignmentRepository.listOpenSignedBy(employeeId),
    ]);
    if (open.length > 0) {
      logger.warn(
        { employeeId, assignments: open.length },
        'employee exited while still holding IT assets — physical return must be recorded by a human (FR-13)',
      );
    }
    for (const assignment of open) {
      await auditService.record({
        entityRef: entityRef(String(assignment.assetId)),
        action: 'alertRaised',
        changes: [change('heldByExitedEmployee', null, employeeId)],
      });
    }
    // The responsible person of a department's custody (2026-11-19): the custody is the
    // department's and stands — only its signature is gone. Flagged the same way, never returned;
    // the remedy is the department signing again (a transfer naming the same department and place
    // with a new responsible person).
    if (signed.length > 0) {
      logger.warn(
        { employeeId, assignments: signed.length },
        "employee exited while responsible for a department's IT assets — have the department sign again (FR-13)",
      );
    }
    for (const assignment of signed) {
      await auditService.record({
        entityRef: entityRef(String(assignment.assetId)),
        action: 'alertRaised',
        changes: [change('responsibleExited', null, employeeId)],
      });
    }
    return open.length + signed.length;
  }

  async history(
    assetId: string,
    query: ListItAssetHistoryQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItAssetEventDoc>> {
    // Read the asset first so history obeys exactly the same authorization as the asset itself —
    // a branch-scoped caller must not read another branch's custody chain.
    const asset = await itAssetRepository.findById(assetId, scope);
    if (asset === null) throw new NotFoundError('asset not found');
    return itAssetEventRepository.listForAsset({
      assetId,
      type: query.type,
      page: query.page,
      pageSize: query.pageSize,
    });
  }
}

export const itAssetCustodyService = new ItAssetCustodyService();
