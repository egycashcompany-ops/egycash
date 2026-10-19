// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type AtmRegisterBranchOptionsQuery,
  type DeleteAtmRegisterEntry,
  type ExportAtmRegisterEntriesQuery,
  type HandoverAtmRegisterEntry,
  type LinkAtmRegisterEntry,
  type ListAtmRegisterEntriesQuery,
  type ReceiveAtmRegisterEntry,
  type ReceivePendingAtmRegisterEntry,
  type UpdateAtmRegisterEntry,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, noContent, ok, validated } from '../../../platform/web';
import { streamRegisterExport } from './register-export';
import { atmRegisterReportService } from './register-report.service';
import { atmRegisterService } from './register.service';

type IdParam = { id: string };

export const getRegisterMeta = async (req: Request, res: Response): Promise<void> => {
  ok(res, await atmRegisterService.meta(authContext(req)));
};

export const getRegisterBranchOptions = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmRegisterBranchOptionsQuery>(req);
  ok(res, await atmRegisterService.branchOptions(query.branchId, authContext(req)));
};

export const getRegisterReport = async (req: Request, res: Response): Promise<void> => {
  ok(res, await atmRegisterReportService.report(authContext(req)));
};

export const exportRegisterEntries = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ExportAtmRegisterEntriesQuery>(req);
  await streamRegisterExport(res, authContext(req), query);
};

export const listRegisterEntries = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAtmRegisterEntriesQuery>(req);
  const page = await atmRegisterService.list(query, authContext(req));
  ok(res, page.items, page.meta);
};

export const receiveRegisterEntry = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ReceiveAtmRegisterEntry>(req);
  created(res, await atmRegisterService.create(body, authContext(req)));
};

export const getRegisterEntry = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await atmRegisterService.get(params.id, authContext(req)));
};

export const updateRegisterEntry = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAtmRegisterEntry, never, IdParam>(req);
  ok(res, await atmRegisterService.update(params.id, body, authContext(req)));
};

export const receivePendingRegisterEntry = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ReceivePendingAtmRegisterEntry, never, IdParam>(req);
  ok(res, await atmRegisterService.receivePending(params.id, body, authContext(req)));
};

export const handoverRegisterEntry = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<HandoverAtmRegisterEntry, never, IdParam>(req);
  ok(res, await atmRegisterService.handover(params.id, body, authContext(req)));
};

export const revealRegisterCombination = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await atmRegisterService.reveal(params.id, authContext(req)));
};

export const linkRegisterEntry = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<LinkAtmRegisterEntry, never, IdParam>(req);
  ok(res, await atmRegisterService.link(params.id, body.version, authContext(req)));
};

export const deleteRegisterEntry = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<DeleteAtmRegisterEntry, never, IdParam>(req);
  await atmRegisterService.remove(params.id, body.version, authContext(req));
  noContent(res);
};
