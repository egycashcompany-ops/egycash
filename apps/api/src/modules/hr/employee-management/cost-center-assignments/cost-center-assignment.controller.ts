import { type Request, type Response } from 'express';
import { type CreateCostCenterAssignment } from '@ecms/contracts';
import { created, noContent, ok } from '../../../../infrastructure/http/respond';
import { validated } from '../../../../infrastructure/http/validate';
import { scopeSelector } from '../../../../shared/types';
import { authContext } from '../../../../platform/auth';
import { costCenterAssignmentService } from './cost-center-assignment.service';

type EmployeeParam = { employeeId: string };
type AssignmentParam = { employeeId: string; assignmentId: string };

export const listEmployeeCostCenters = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, EmployeeParam>(req);
  ok(
    res,
    await costCenterAssignmentService.listForEmployee(
      params.employeeId,
      scopeSelector(ctx, 'costCenter.view'),
    ),
  );
};

export const assignEmployeeCostCenter = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CreateCostCenterAssignment, never, EmployeeParam>(req);
  const doc = await costCenterAssignmentService.create(
    ctx,
    params.employeeId,
    scopeSelector(ctx, 'costCenter.assign'),
    body,
  );
  created(res, { id: String(doc._id) });
};

export const endEmployeeCostCenter = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<{ on: Date }, never, AssignmentParam>(req);
  await costCenterAssignmentService.end(
    ctx,
    params.employeeId,
    scopeSelector(ctx, 'costCenter.assign'),
    params.assignmentId,
    body.on,
  );
  noContent(res);
};
