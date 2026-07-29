import { type Request, type Response } from 'express';
import {
  type CreateAutomationWorkflow,
  type ListAutomationWorkflowsQuery,
  type SetAutomationWorkflowEnabled,
  type TransferAutomationWorkflow,
  type UpdateAutomationWorkflow,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../../infrastructure/http/respond';
import { validated } from '../../../infrastructure/http/validate';
import { scopeSelector } from '../../../shared/types';
import { authContext } from '../../../platform/auth';
import { automationWorkflowService } from './workflow.service';

type IdParam = { id: string };

export const listWorkflows = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListAutomationWorkflowsQuery>(req);
  const page = await automationWorkflowService.list(query, scopeSelector(ctx, 'workflow.view'));
  okPage(res, page, (doc) => automationWorkflowService.toDto(doc));
};

export const getWorkflow = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await automationWorkflowService.getById(
    params.id,
    scopeSelector(ctx, 'workflow.view'),
  );
  ok(res, automationWorkflowService.toDto(doc));
};

/**
 * Trigger problems for a stored workflow, without saving anything. A workflow can become invalid
 * without being touched — the event it listens to may be deprecated after it was written — so this
 * is a read, not a side effect of an edit.
 */
export const diagnoseWorkflow = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const problems = await automationWorkflowService.diagnose(
    params.id,
    scopeSelector(ctx, 'workflow.view'),
  );
  ok(res, { problems });
};

export const createWorkflow = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateAutomationWorkflow>(req);
  const { doc, warnings } = await automationWorkflowService.create(body, ctx.userId);
  created(
    res,
    { ...automationWorkflowService.toDto(doc), warnings },
    `/api/v1/automation/workflows/${String(doc._id)}`,
  );
};

export const updateWorkflow = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateAutomationWorkflow, never, IdParam>(req);
  const { doc, warnings } = await automationWorkflowService.update(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'workflow.edit'),
  );
  ok(res, { ...automationWorkflowService.toDto(doc), warnings });
};

export const setWorkflowEnabled = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SetAutomationWorkflowEnabled, never, IdParam>(req);
  const doc = await automationWorkflowService.setEnabled(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'workflow.enable'),
  );
  ok(res, automationWorkflowService.toDto(doc));
};

export const transferWorkflow = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<TransferAutomationWorkflow, never, IdParam>(req);
  const doc = await automationWorkflowService.transfer(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'workflow.transfer'),
  );
  ok(res, automationWorkflowService.toDto(doc));
};

export const deleteWorkflow = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await automationWorkflowService.softDelete(
    params.id,
    ctx.userId,
    scopeSelector(ctx, 'workflow.delete'),
  );
  noContent(res);
};
