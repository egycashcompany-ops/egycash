// Thin HTTP mapping only (ADR-003). The relationship-or-permission rules (R9) live in the
// service; this layer computes the caller's capability flags from effective permissions and
// resolves the `own` scope's single-target shape (C1-R).
import { type Request, type Response } from 'express';
import {
  type CancelLeaveRequest,
  type CreateLeaveRequest,
  type DecideLeaveRequest,
  type LeaveCalendarQuery,
  type LeaveEligibilityQuery,
  type ListLeaveRequestsQuery,
  type ReturnLeaveRequest,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { NotFoundError, ValidationError } from '../../../../shared/errors';
import { hasPermission, scopeSelector, type AuthContext } from '../../../../shared/types';
import { employeeRepository, type EmployeeDoc } from '../../employee-management/employees';
import { leaveRequestService, type LeaveCallerFlags } from './leave-request.service';
import { toLeaveRequestDto } from './leave-request.mapper';

type IdParam = { id: string };

const callerFlags = (ctx: AuthContext): LeaveCallerFlags => ({
  hasApprove: hasPermission(ctx, 'leave.approve'),
  approveScope: hasPermission(ctx, 'leave.approve') ? scopeSelector(ctx, 'leave.approve') : null,
  canCancelApproved: hasPermission(ctx, 'leave.cancelApproved'),
});

/**
 * Resolve an employee-keyed read under a scoped permission. The `own` scope has no row to
 * filter (C1-R): it matches when the target employee IS the caller.
 */
export const resolveEmployeeForRead = async (
  ctx: AuthContext,
  employeeId: string,
  permission: string,
): Promise<EmployeeDoc> => {
  const scope = scopeSelector(ctx, permission);
  if (scope.scope === 'own') {
    const employee = await employeeRepository.findById(employeeId);
    if (employee === null || employee.userId === null || String(employee.userId) !== ctx.userId) {
      throw new NotFoundError('employee not found');
    }
    return employee;
  }
  return employeeRepository.getById(employeeId, scope);
};

export const submitLeaveRequest = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateLeaveRequest, never, never>(req);
  const onBehalf = hasPermission(ctx, 'leave.requestForOthers');
  const doc = await leaveRequestService.submit(ctx, body, {
    onBehalf: onBehalf && body.employeeId !== undefined,
  });
  created(res, toLeaveRequestDto(doc), `/api/v1/hr/leave-requests/${String(doc._id)}`);
};

export const listLeaveRequests = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListLeaveRequestsQuery, never>(req);
  okPage(res, await leaveRequestService.list(query, scopeSelector(ctx, 'leave.view')), toLeaveRequestDto);
};

export const getLeaveRequest = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const viewScope = hasPermission(ctx, 'leave.view') ? scopeSelector(ctx, 'leave.view') : null;
  const doc = await leaveRequestService.getById(params.id, ctx, callerFlags(ctx), viewScope);
  ok(res, toLeaveRequestDto(doc));
};

export const pendingLeaveApprovals = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const docs = await leaveRequestService.pendingApprovals(ctx, callerFlags(ctx));
  ok(res, docs.map(toLeaveRequestDto));
};

export const approveLeaveRequest = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideLeaveRequest, never, IdParam>(req);
  const doc = await leaveRequestService.decide(ctx, params.id, 'approved', body, callerFlags(ctx));
  ok(res, toLeaveRequestDto(doc));
};

export const rejectLeaveRequest = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideLeaveRequest, never, IdParam>(req);
  const doc = await leaveRequestService.decide(ctx, params.id, 'rejected', body, callerFlags(ctx));
  ok(res, toLeaveRequestDto(doc));
};

export const cancelLeaveRequest = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CancelLeaveRequest, never, IdParam>(req);
  const doc = await leaveRequestService.cancel(ctx, params.id, body, callerFlags(ctx));
  ok(res, toLeaveRequestDto(doc));
};

export const returnLeaveRequest = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ReturnLeaveRequest, never, IdParam>(req);
  const doc = await leaveRequestService.earlyReturn(ctx, params.id, body, callerFlags(ctx));
  ok(res, toLeaveRequestDto(doc));
};

export const attachToLeaveRequest = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'body.file', code: 'REQUIRED', message: 'multipart field "file" is required' },
    ]);
  }
  const doc = await leaveRequestService.attach(
    ctx,
    params.id,
    { originalName: file.originalname, mime: file.mimetype, size: file.size, buffer: file.buffer },
    callerFlags(ctx),
  );
  ok(res, toLeaveRequestDto(doc));
};

export const unreconciledLeave = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  ok(res, await leaveRequestService.unreconciled(scopeSelector(ctx, 'leave.approve')));
};

export const leaveCalendar = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, LeaveCalendarQuery, never>(req);
  const docs = await leaveRequestService.calendar(query.from, query.to, scopeSelector(ctx, 'leave.view'));
  ok(res, docs.map(toLeaveRequestDto));
};

export const leaveEligibility = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, LeaveEligibilityQuery, IdParam>(req);
  const employee = await resolveEmployeeForRead(ctx, params.id, 'leave.view');
  ok(
    res,
    await leaveRequestService.eligibility(employee, {
      typeId: query.typeId,
      start: query.start,
      end: query.end,
      halfDayStart: query.halfDayStart ?? false,
      halfDayEnd: query.halfDayEnd ?? false,
    }),
  );
};
