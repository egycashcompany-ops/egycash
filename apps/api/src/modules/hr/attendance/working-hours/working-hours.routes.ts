// WORKING HOURS PER DEPARTMENT — the settings panel behind Attendance › Working hours.
//
// The value is one organization setting (`hr.attendance.departmentHours`), so validation, the
// audit trail and the cache invalidation are the settings service's own. This router exists because
// the generic settings screen cannot edit a map, and because the people who own working hours hold
// `attendance.manageWorkingHours`, not `setting.edit`: the route checks the attendance key, then
// writes through the settings service with organization authority for THIS ONE KEY only.
import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  DepartmentHoursMapSchema,
  HrAttendanceSettingKeys,
  type DepartmentHoursMap,
  type LocalizedString,
} from '@ecms/contracts';
import { asyncHandler, ok, validated, validate } from '../../../../platform/web';
import { authenticate, authContext } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { settingsService } from '../../../../platform/settings';
import { DepartmentModel } from '../../../../platform/organization/departments';
import { BranchModel } from '../../../../platform/organization/branches/branch.model';
import { EmployeeModel } from '../../employee-management/employees/employee.model';
import { departmentHoursMap } from '../day-records/expectations';
import { dayRecordService } from '../day-records/day-record.service';
import { cairoToday } from '../../shared/business-date';
import { logger } from '../../../../infrastructure/logging/logger';
import { AuditLogModel } from '../../../../platform/audit/audit.model';

const ORG = { userId: null, branchId: null };
const WorkingHoursBody = z.object({ departments: DepartmentHoursMapSchema }).strict();

const minutesOf = (time: string): number => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

const readWorkingHours = async (_req: Request, res: Response): Promise<void> => {
  const [map, enabled, startTime, endTime, breakMinutes, departments, branches, headcount] =
    await Promise.all([
      departmentHoursMap(),
      settingsService.resolve<boolean>(HrAttendanceSettingKeys.DefaultPatternEnabled, ORG),
      settingsService.resolve<string>(HrAttendanceSettingKeys.DefaultPatternStartTime, ORG),
      settingsService.resolve<string>(HrAttendanceSettingKeys.DefaultPatternEndTime, ORG),
      settingsService.resolve<number>(HrAttendanceSettingKeys.DefaultPatternBreakMinutes, ORG),
      DepartmentModel.find({ isDeleted: false })
        .select({ name: 1, code: 1, branchId: 1, catalogId: 1, status: 1 })
        .lean<{ _id: Types.ObjectId; name: LocalizedString; code: string; branchId: Types.ObjectId; catalogId: Types.ObjectId | null }[]>()
        .exec(),
      BranchModel.find({ isDeleted: false })
        .select({ name: 1 })
        .lean<{ _id: Types.ObjectId; name: LocalizedString }[]>()
        .exec(),
      EmployeeModel.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { isDeleted: false, status: { $ne: 'exited' } } },
        { $group: { _id: '$employment.departmentId', n: { $sum: 1 } } },
      ]).exec(),
    ]);
  const branchName = new Map(branches.map((b) => [String(b._id), b.name]));
  const countOf = new Map(headcount.map((h) => [String(h._id), h.n]));
  const span = (minutesOf(endTime) - minutesOf(startTime) + 1440) % 1440 || 1440;
  ok(res, {
    companyDefault: {
      enabled,
      startTime,
      endTime,
      breakMinutes,
      hours: Math.round(((span - breakMinutes) / 60) * 100) / 100,
    },
    departments: departments.map((d) => ({
      id: String(d._id),
      code: d.code,
      name: d.name,
      branchId: String(d.branchId),
      branchName: branchName.get(String(d.branchId)) ?? null,
      catalogId: d.catalogId === null ? null : String(d.catalogId),
      employees: countOf.get(String(d._id)) ?? 0,
      rule: map[String(d._id)] ?? null,
    })),
  });
};

const writeWorkingHours = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<{ departments: DepartmentHoursMap }, never, never>(req);
  const before = await departmentHoursMap();
  await settingsService.set(
    // Organization authority for this one key — the route has already required
    // `attendance.manageWorkingHours`, which is the key that owns working hours.
    { ...ctx, permissions: { ...ctx.permissions, 'setting.edit': 'organization' } },
    {
      key: HrAttendanceSettingKeys.DepartmentHours,
      scope: 'organization',
      value: body.departments,
    },
  );

  // The days already written for this month were derived against the OLD hours. Re-derive them
  // for the people in the departments that changed, so the sheet, the profile and payroll's feed
  // agree with the new rule. Frozen days are never touched (computeDay refuses them). Not awaited:
  // a department of hundreds must not hold the save open — the read paths derive live meanwhile.
  const changed = new Set(
    [...Object.keys(before), ...Object.keys(body.departments)].filter(
      (id) => JSON.stringify(before[id] ?? null) !== JSON.stringify(body.departments[id] ?? null),
    ),
  );
  let queued = 0;
  if (changed.size > 0) {
    const people = await EmployeeModel.find({
      isDeleted: false,
      status: { $ne: 'exited' },
      'employment.departmentId': { $in: [...changed].map((id) => new Types.ObjectId(id)) },
    })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    queued = people.length;
    const today = cairoToday();
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    void (async () => {
      for (const person of people) {
        try {
          await dayRecordService.recomputeSpanForEmployee(String(person._id), from, today);
        } catch (err) {
          logger.warn({ err, employeeId: String(person._id) }, 'working hours: recompute failed');
        }
      }
    })();
  }
  ok(res, { saved: Object.keys(body.departments).length, recomputing: queued });
};

type HoursRule = { startTime: string; hours: number } | null;

/**
 * «سجل التعديلات» — who changed which department's working hours, and when.
 *
 * Nothing new is stored for it: every save goes through the settings service, which already writes
 * an audit row with the actor (as they were then), the time, and the whole map before and after.
 * This reads those rows, newest first, and splits each into one line per department that changed:
 * its hours before and after (null = not set, so the company default applied).
 */
const workingHoursHistory = async (req: Request, res: Response): Promise<void> => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 300);
  const rows = await AuditLogModel.find({
    'entityRef.moduleId': 'platform',
    'entityRef.entityType': 'setting',
    'entityRef.entityId': HrAttendanceSettingKeys.DepartmentHours,
  })
    .sort({ at: -1 })
    .limit(limit)
    .lean()
    .exec();

  const lines: {
    id: string;
    at: string;
    by: LocalizedString | null;
    departmentId: string;
    before: HoursRule;
    after: HoursRule;
  }[] = [];
  for (const row of rows) {
    const change = row.changes[0];
    const before = (change?.old ?? {}) as Record<string, HoursRule>;
    const after = (change?.new ?? {}) as Record<string, HoursRule>;
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const b = before[id] ?? null;
      const a = after[id] ?? null;
      if (JSON.stringify(b) === JSON.stringify(a)) continue;
      lines.push({
        id: `${String(row._id)}:${id}`,
        at: new Date(row.at).toISOString(),
        by: row.actorSnapshot?.displayName ?? null,
        departmentId: id,
        before: b === null ? null : { startTime: b.startTime, hours: b.hours },
        after: a === null ? null : { startTime: a.startTime, hours: a.hours },
      });
    }
  }

  const ids = [...new Set(lines.map((l) => l.departmentId))].filter((id) => Types.ObjectId.isValid(id));
  const [departments, branches] = await Promise.all([
    DepartmentModel.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .select({ name: 1, branchId: 1 })
      .lean<{ _id: Types.ObjectId; name: LocalizedString; branchId: Types.ObjectId }[]>()
      .exec(),
    BranchModel.find({}).select({ name: 1 }).lean<{ _id: Types.ObjectId; name: LocalizedString }[]>().exec(),
  ]);
  const dept = new Map(departments.map((d) => [String(d._id), d]));
  const branchName = new Map(branches.map((b) => [String(b._id), b.name]));
  ok(
    res,
    lines.map((l) => {
      const d = dept.get(l.departmentId);
      return {
        ...l,
        departmentName: d?.name ?? null,
        branchName: d === undefined ? null : (branchName.get(String(d.branchId)) ?? null),
      };
    }),
  );
};

export const buildAttendanceWorkingHoursRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('attendance.manageWorkingHours'),
    asyncHandler(readWorkingHours),
  );
  router.get(
    '/history',
    authenticate,
    authorize('attendance.manageWorkingHours'),
    asyncHandler(workingHoursHistory),
  );
  router.put(
    '/',
    authenticate,
    authorize('attendance.manageWorkingHours'),
    validate({ body: WorkingHoursBody }),
    asyncHandler(writeWorkingHours),
  );
  return router;
};
