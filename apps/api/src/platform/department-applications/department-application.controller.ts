import { type Request, type Response } from 'express';
import { type AssignApplication } from '@ecms/contracts';
import { created, noContent, ok } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
// Reuse the applications DTO mapper for the assigned-application response.
import { applicationService } from '../applications/application.service';
import { departmentApplicationService } from './department-application.service';

type DeptParam = { departmentId: string };
type DeptAppParam = { departmentId: string; applicationId: string };

export const listDepartmentApplications = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, DeptParam>(req);
  ok(res, await departmentApplicationService.listApplications(params.departmentId));
};

export const assignDepartmentApplication = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AssignApplication, never, DeptParam>(req);
  const application = await departmentApplicationService.assign(
    params.departmentId,
    body.applicationId,
    ctx.userId,
  );
  created(
    res,
    applicationService.toDto(application),
    `/api/v1/platform/departments/${params.departmentId}/applications/${body.applicationId}`,
  );
};

export const removeDepartmentApplication = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, DeptAppParam>(req);
  await departmentApplicationService.remove(params.departmentId, params.applicationId, ctx.userId);
  noContent(res);
};
