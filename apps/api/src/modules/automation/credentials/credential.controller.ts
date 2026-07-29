import { type Request, type Response } from 'express';
import {
  type CreateAutomationCredential,
  type ListAutomationCredentialsQuery,
  type ReplaceAutomationCredentialValue,
  type UpdateAutomationCredential,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../../infrastructure/http/respond';
import { validated } from '../../../infrastructure/http/validate';
import { scopeSelector } from '../../../shared/types';
import { authContext } from '../../../platform/auth';
import { automationCredentialService } from './credential.service';

type IdParam = { id: string };

// Every handler below returns `toDto`, which has no value field. There is deliberately no
// `getCredentialValue` — §7.3: a stolen session can USE a credential, never exfiltrate one.

export const listCredentials = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListAutomationCredentialsQuery>(req);
  const page = await automationCredentialService.list(query, scopeSelector(ctx, 'credential.view'));
  okPage(res, page, (doc) => automationCredentialService.toDto(doc));
};

export const getCredential = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await automationCredentialService.getById(
    params.id,
    scopeSelector(ctx, 'credential.view'),
  );
  ok(res, automationCredentialService.toDto(doc));
};

export const createCredential = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateAutomationCredential>(req);
  const doc = await automationCredentialService.create(body, ctx.userId);
  created(
    res,
    automationCredentialService.toDto(doc),
    `/api/v1/automation/credentials/${String(doc._id)}`,
  );
};

export const replaceCredentialValue = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ReplaceAutomationCredentialValue, never, IdParam>(req);
  const doc = await automationCredentialService.replaceValue(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'credential.edit'),
  );
  ok(res, automationCredentialService.toDto(doc));
};

export const updateCredential = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateAutomationCredential, never, IdParam>(req);
  const doc = await automationCredentialService.updateMetadata(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'credential.edit'),
  );
  ok(res, automationCredentialService.toDto(doc));
};

export const deleteCredential = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await automationCredentialService.softDelete(
    params.id,
    ctx.userId,
    scopeSelector(ctx, 'credential.delete'),
  );
  noContent(res);
};
