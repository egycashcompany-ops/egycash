// Thin HTTP mapping only (ADR-003). The configuration surface; deciding a request happens on the
// request's OWN route, in the module that owns it, because a decision moves that aggregate too.
import { type Request, type Response } from 'express';
import { type SetApprovalWorkflow } from '@ecms/contracts';
import { ok, noContent } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { approvalService } from './approval.service';

export const listWorkflows = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await approvalService.listWorkflows());
};

export const listRequestTypes = async (_req: Request, res: Response): Promise<void> => {
  ok(res, approvalService.listRequestTypes());
};

export const setWorkflow = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SetApprovalWorkflow>(req);
  ok(res, await approvalService.setWorkflow(body, authContext(req)));
};

export const deleteWorkflow = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { id: string }>(req);
  await approvalService.deleteWorkflow(params.id, authContext(req));
  noContent(res);
};
