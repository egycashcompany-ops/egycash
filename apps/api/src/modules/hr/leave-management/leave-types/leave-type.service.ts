// Leave Type catalog service (frozen design §2). Updates re-validate COHERENCE on the merged
// result (the contracts refine only sees the partial patch). The pure entitlement calculator
// lives here so balances/grants and eligibility share one implementation.
import { Types } from 'mongoose';
import {
  type CreateLeaveType,
  type LeaveTypeDto,
  type UpdateLeaveType,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { LeaveTypeModel, type LeaveTypeDoc } from './leave-type.model';
import { leaveTypeRepository } from './leave-type.repository';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'leaveType', entityId: id });

export const toLeaveTypeDto = (doc: LeaveTypeDoc): LeaveTypeDto => ({
  id: String(doc._id),
  code: doc.code,
  name: doc.name,
  payModel: doc.payModel,
  payTiers: doc.payTiers,
  balanceSource: doc.balanceSource,
  balanceTypeId: doc.balanceTypeId === null ? null : String(doc.balanceTypeId),
  baseDays: doc.baseDays,
  entitlementSteps: doc.entitlementSteps,
  ageStepAge: doc.ageStepAge,
  ageStepDays: doc.ageStepDays,
  minServiceMonths: doc.minServiceMonths,
  gender: doc.gender,
  maxPerService: doc.maxPerService,
  allowedDuringProbation: doc.allowedDuringProbation,
  minNoticeDays: doc.minNoticeDays,
  maxConsecutiveDays: doc.maxConsecutiveDays,
  maxPerYearDays: doc.maxPerYearDays,
  maxPerOccasionDays: doc.maxPerOccasionDays,
  backdateDays: doc.backdateDays,
  requiresAttachment: doc.requiresAttachment,
  attachmentStage: doc.attachmentStage,
  allowHalfDay: doc.allowHalfDay,
  countingMode: doc.countingMode,
  affectsEmployeeStatus: doc.affectsEmployeeStatus,
  statusThresholdDays: doc.statusThresholdDays,
  approvalShape: doc.approvalShape,
  carryoverMode: doc.carryoverMode,
  carryoverCapDays: doc.carryoverCapDays,
  carryoverExpiryMonths: doc.carryoverExpiryMonths,
  negativeCapDays: doc.negativeCapDays,
  active: doc.active,
  sortOrder: doc.sortOrder,
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

/** R13 + structural coherence, applied to the MERGED type (create and update alike). */
const assertCoherent = (t: Pick<
  LeaveTypeDoc,
  'affectsEmployeeStatus' | 'allowHalfDay' | 'balanceSource' | 'balanceTypeId' | 'baseDays' | 'payModel' | 'payTiers'
>): void => {
  if (t.affectsEmployeeStatus && t.allowHalfDay) {
    throw new BusinessRuleError('a status-affecting type cannot allow half-days');
  }
  if (t.balanceSource === 'otherType' && t.balanceTypeId === null) {
    throw new BusinessRuleError('balanceSource otherType requires balanceTypeId');
  }
  if (t.balanceSource === 'self' && t.baseDays === null) {
    throw new BusinessRuleError('a banked type requires baseDays');
  }
  if (t.payModel === 'tiered' && t.payTiers.length === 0) {
    throw new BusinessRuleError('tiered pay requires at least one tier');
  }
};

/**
 * Entitled banked days for a leave-year: the best applicable of base / service steps /
 * age step (annual: 15 → 21 after 1 service year → 30 after 10 years OR age 50).
 */
export const entitledDays = (
  type: Pick<LeaveTypeDoc, 'baseDays' | 'entitlementSteps' | 'ageStepAge' | 'ageStepDays'>,
  serviceYears: number,
  age: number | null,
): number => {
  let days = type.baseDays ?? 0;
  for (const step of [...type.entitlementSteps].sort((a, b) => a.afterServiceYears - b.afterServiceYears)) {
    if (serviceYears >= step.afterServiceYears) days = Math.max(days, step.days);
  }
  if (
    type.ageStepAge !== null &&
    type.ageStepDays !== null &&
    age !== null &&
    age >= type.ageStepAge
  ) {
    days = Math.max(days, type.ageStepDays);
  }
  return days;
};

class LeaveTypeService {
  async list(): Promise<LeaveTypeDoc[]> {
    return leaveTypeRepository.listAll();
  }

  async getById(id: string): Promise<LeaveTypeDoc> {
    const doc = await leaveTypeRepository.findById(id);
    if (doc === null) throw new NotFoundError('leave type not found');
    return doc;
  }

  async getActiveById(id: string): Promise<LeaveTypeDoc> {
    const doc = await this.getById(id);
    if (!doc.active) throw new BusinessRuleError('this leave type is inactive');
    return doc;
  }

  /** The balance target of a request of this type (R11): own id, another type, or null. */
  resolveBalanceTypeId(type: LeaveTypeDoc): string | null {
    if (type.balanceSource === 'self') return String(type._id);
    if (type.balanceSource === 'otherType') return String(type.balanceTypeId);
    return null;
  }

  async create(ctx: AuthContext, input: CreateLeaveType): Promise<LeaveTypeDoc> {
    const existing = await leaveTypeRepository.findByCode(input.code);
    if (existing !== null) throw new ConflictError('a leave type with this code already exists');
    if (input.balanceTypeId !== null && input.balanceSource === 'otherType') {
      const target = await this.getById(input.balanceTypeId);
      if (target.balanceSource !== 'self') {
        throw new BusinessRuleError('balanceTypeId must reference a banked (self) type');
      }
    }
    const doc = await leaveTypeRepository.create(
      {
        ...input,
        balanceTypeId: input.balanceTypeId === null ? null : new Types.ObjectId(input.balanceTypeId),
      },
      { by: ctx.userId },
    );
    assertCoherent(doc);
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [{ field: 'code', old: null, new: doc.code }],
    });
    return doc;
  }

  async update(ctx: AuthContext, id: string, input: UpdateLeaveType): Promise<LeaveTypeDoc> {
    const current = await this.getById(id);
    const { version, balanceTypeId, ...rest } = input;
    const patch: Record<string, unknown> = { ...rest };
    if (balanceTypeId !== undefined) {
      patch['balanceTypeId'] = balanceTypeId === null ? null : new Types.ObjectId(balanceTypeId);
      if (balanceTypeId !== null) {
        if (balanceTypeId === id) throw new BusinessRuleError('a type cannot deduct from itself');
        const target = await this.getById(balanceTypeId);
        if (target.balanceSource !== 'self') {
          throw new BusinessRuleError('balanceTypeId must reference a banked (self) type');
        }
      }
    }
    const merged = { ...current, ...patch } as LeaveTypeDoc;
    assertCoherent(merged);
    const updated = await leaveTypeRepository.updateById(id, patch as Partial<LeaveTypeDoc>, {
      by: ctx.userId,
      version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: Object.keys(rest).map((field) => ({
        field,
        old: JSON.stringify((current as unknown as Record<string, unknown>)[field] ?? null),
        new: JSON.stringify((updated as unknown as Record<string, unknown>)[field] ?? null),
      })),
    });
    return updated;
  }

  /** Idempotent boot seed helper: create-if-missing by code (migration step ①). */
  async ensure(input: CreateLeaveType & { balanceTypeCode?: string }): Promise<LeaveTypeDoc> {
    const existing = await leaveTypeRepository.findByCode(input.code);
    if (existing !== null) return existing;
    const { balanceTypeCode, ...rest } = input;
    let balanceTypeId: string | null = rest.balanceTypeId;
    if (balanceTypeCode !== undefined) {
      const target = await leaveTypeRepository.findByCode(balanceTypeCode);
      if (target === null) throw new BusinessRuleError(`seed order: ${balanceTypeCode} missing`);
      balanceTypeId = String(target._id);
    }
    return LeaveTypeModel.create({
      ...rest,
      balanceTypeId: balanceTypeId === null ? null : new Types.ObjectId(balanceTypeId),
      createdBy: null,
    });
  }
}

export const leaveTypeService = new LeaveTypeService();
