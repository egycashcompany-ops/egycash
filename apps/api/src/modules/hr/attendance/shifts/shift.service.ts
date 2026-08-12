// Shift catalog service. Updates re-validate time coherence on the MERGED result — the contracts
// superRefine only sees what the patch carries (the leave-types idiom).
import {
  type CreateShift,
  type ShiftDto,
  type UpdateShift,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { ShiftModel, type ShiftDoc } from './shift.model';
import { shiftRepository } from './shift.repository';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'attendanceShift', entityId: id });

export const toShiftDto = (doc: ShiftDoc): ShiftDto => ({
  id: String(doc._id),
  code: doc.code,
  name: doc.name,
  startTime: doc.startTime,
  endTime: doc.endTime,
  crossesMidnight: doc.crossesMidnight,
  breakMinutes: doc.breakMinutes,
  graceInMinutes: doc.graceInMinutes,
  graceOutMinutes: doc.graceOutMinutes,
  minMinutesForFullDay: doc.minMinutesForFullDay,
  minMinutesForHalfDay: doc.minMinutesForHalfDay,
  active: doc.active,
  sortOrder: doc.sortOrder,
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

/** The same rule the create schema enforces, applied to the merged update result. */
const assertTimesCoherent = (
  s: Pick<ShiftDoc, 'startTime' | 'endTime' | 'crossesMidnight'>,
): void => {
  if (!s.crossesMidnight && s.endTime <= s.startTime) {
    throw new BusinessRuleError('a same-day shift must end after it starts');
  }
  if (s.crossesMidnight && s.endTime >= s.startTime) {
    throw new BusinessRuleError('a midnight-crossing shift must end before its start time');
  }
};

class ShiftService {
  async list(): Promise<ShiftDoc[]> {
    return shiftRepository.listAll();
  }

  async getById(id: string): Promise<ShiftDoc> {
    const doc = await shiftRepository.findById(id);
    if (doc === null) throw new NotFoundError('shift not found');
    return doc;
  }

  async getActiveById(id: string): Promise<ShiftDoc> {
    const doc = await this.getById(id);
    if (!doc.active) throw new BusinessRuleError('this shift is inactive');
    return doc;
  }

  async create(ctx: AuthContext, input: CreateShift): Promise<ShiftDoc> {
    const existing = await shiftRepository.findByCode(input.code);
    if (existing !== null) throw new ConflictError('a shift with this code already exists');
    const doc = await shiftRepository.create(input, { by: ctx.userId });
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [{ field: 'code', old: null, new: doc.code }],
    });
    return doc;
  }

  async update(ctx: AuthContext, id: string, input: UpdateShift): Promise<ShiftDoc> {
    const current = await this.getById(id);
    const { version, ...rest } = input;
    const merged = { ...current, ...rest } as ShiftDoc;
    assertTimesCoherent(merged);
    const updated = await shiftRepository.updateById(id, rest as Partial<ShiftDoc>, {
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

  /** Deactivate rather than delete — assignments and day records reference shifts forever. */
  async deactivate(ctx: AuthContext, id: string, version: number): Promise<ShiftDoc> {
    const current = await this.getById(id);
    if (!current.active) return current;
    const updated = await shiftRepository.updateById(id, { active: false }, { by: ctx.userId, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'active', old: 'true', new: 'false' }],
    });
    return updated;
  }

  /** Idempotent boot-seed helper: create-if-missing by code (migration step). */
  async ensure(input: CreateShift): Promise<ShiftDoc> {
    const existing = await shiftRepository.findByCode(input.code);
    if (existing !== null) return existing;
    return ShiftModel.create({ ...input, createdBy: null });
  }
}

export const shiftService = new ShiftService();
