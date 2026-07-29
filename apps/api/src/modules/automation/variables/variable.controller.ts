import { type Request, type Response } from 'express';
import { type ListAutomationVariablesQuery, type UpsertAutomationVariable } from '@ecms/contracts';
import { noContent, ok, okPage } from '../../../infrastructure/http/respond';
import { validated } from '../../../infrastructure/http/validate';
import { scopeSelector } from '../../../shared/types';
import { authContext } from '../../../platform/auth';
import { automationVariableService } from './variable.service';

type KeyParam = { key: string };
type IdParam = { id: string };

export const listVariables = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListAutomationVariablesQuery>(req);
  const page = await automationVariableService.list(query, scopeSelector(ctx, 'variable.view'));
  okPage(res, page, (doc) => automationVariableService.toDto(doc));
};

export const upsertVariable = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpsertAutomationVariable, never, KeyParam>(req);
  const doc = await automationVariableService.upsert(params.key, body, ctx.userId);
  ok(res, automationVariableService.toDto(doc));
};

export const deleteVariable = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await automationVariableService.softDelete(
    params.id,
    ctx.userId,
    scopeSelector(ctx, 'variable.edit'),
  );
  noContent(res);
};
