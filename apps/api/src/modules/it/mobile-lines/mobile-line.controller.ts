// Thin HTTP mapping only (ADR-003). Every write answers with the LINE in its new state, holder
// resolved, so the screen never re-fetches to learn what its own action did.
//
// Scopes follow the asset register exactly: reads under `itAsset.view`, an edit under
// `itAsset.edit`, and the custody writes (hand over, return) gated on `itAsset.assign` but scoped
// by the READ grant — whoever may hand a line out may reach every line they can see.
import { type Request, type Response } from 'express';
import {
  type AssignItMobileLine,
  type CreateItMobileLine,
  type ItMobileLinesSummaryQuery,
  type ItMobileLineStatusAction,
  type ListItMobileLineAssignmentsQuery,
  type ListItMobileLineHistoryQuery,
  type ListItMobileLinesQuery,
  type ReturnItMobileLine,
  type UpdateItMobileLine,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { hasPermission, scopeSelector } from '../../../shared/types';
import {
  toItMobileLineAssignmentDto,
  toItMobileLineDto,
  toItMobileLineHistoryEntryDto,
  toItMobileLineReceiptDto,
} from '../it.mappers';
import { itMobileLineService } from './mobile-line.service';
import { itMobileLineCustodyService } from './line-custody.service';
import { type ItMobileLineDoc } from './mobile-line.model';

type IdParam = { id: string };

const viewScope = (req: Request) => scopeSelector(authContext(req), 'itAsset.view');

/** One line, as every write answers it — its holder read the way a page of the register is. */
const lineDto = async (line: ItMobileLineDoc) =>
  toItMobileLineDto(line, await itMobileLineService.holderLabels([line]));

export const listItMobileLines = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItMobileLinesQuery>(req);
  const page = await itMobileLineService.list(query, viewScope(req));
  const labels = await itMobileLineService.holderLabels(page.items);
  okPage(res, page, (doc) => toItMobileLineDto(doc, labels));
};

export const getItMobileLinesSummary = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ItMobileLinesSummaryQuery>(req);
  ok(res, await itMobileLineService.summary(query, viewScope(req)));
};

export const createItMobileLine = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItMobileLine>(req);
  const line = await itMobileLineService.register(body, authContext(req));
  created(res, await lineDto(line));
};

export const getItMobileLine = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await lineDto(await itMobileLineService.get(params.id, viewScope(req))));
};

export const updateItMobileLine = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItMobileLine, never, IdParam>(req);
  const ctx = authContext(req);
  const line = await itMobileLineService.update(
    params.id,
    body,
    ctx,
    scopeSelector(ctx, 'itAsset.edit'),
  );
  ok(res, await lineDto(line));
};

export const listItMobileLineHistory = async (req: Request, res: Response): Promise<void> => {
  const { params, query } = validated<never, ListItMobileLineHistoryQuery, IdParam>(req);
  const page = await itMobileLineService.history(params.id, query, viewScope(req));
  okPage(res, page, toItMobileLineHistoryEntryDto);
};

export const assignItMobileLine = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AssignItMobileLine, never, IdParam>(req);
  const ctx = authContext(req);
  const { line, receipt } = await itMobileLineCustodyService.assign(
    params.id,
    body,
    ctx,
    viewScope(req),
  );
  ok(res, {
    line: await lineDto(line),
    receipt:
      receipt === null
        ? null
        : toItMobileLineReceiptDto(receipt, hasPermission(ctx, 'itAsset.viewNationalId')),
  });
};

export const returnItMobileLine = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ReturnItMobileLine, never, IdParam>(req);
  const { line } = await itMobileLineCustodyService.returnLine(
    params.id,
    body,
    authContext(req),
    viewScope(req),
  );
  ok(res, await lineDto(line));
};

/** Suspend and reactivate change the register's state, not its custody: `itAsset.edit`'s scope. */
export const suspendItMobileLine = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ItMobileLineStatusAction, never, IdParam>(req);
  const ctx = authContext(req);
  const line = await itMobileLineCustodyService.suspend(
    params.id,
    body,
    ctx,
    scopeSelector(ctx, 'itAsset.edit'),
  );
  ok(res, await lineDto(line));
};

export const reactivateItMobileLine = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ItMobileLineStatusAction, never, IdParam>(req);
  const ctx = authContext(req);
  const line = await itMobileLineCustodyService.reactivate(
    params.id,
    body,
    ctx,
    scopeSelector(ctx, 'itAsset.edit'),
  );
  ok(res, await lineDto(line));
};

/** The custody intervals across lines — «who had which line, when». */
export const listItMobileLineAssignments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItMobileLineAssignmentsQuery>(req);
  const scope = viewScope(req);
  const page = await itMobileLineService.listAssignments(query, scope);
  const { holders, lines, receipts } = await itMobileLineService.assignmentLabels(
    page.items,
    scope,
  );
  okPage(res, page, (doc) => toItMobileLineAssignmentDto(doc, holders, lines, receipts));
};
