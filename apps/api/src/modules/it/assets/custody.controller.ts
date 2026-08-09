// Thin HTTP mapping only (ADR-003). Every custody action returns the ASSET in its new state, so a
// client never has to re-fetch to learn what its own action did — and never has to guess, because
// `status` is derived server-side (FR-2).
import { type Request, type Response } from 'express';
import {
  type AssignItAsset,
  type DisposeItAsset,
  type ListItAssetHistoryQuery,
  type ListItAssignmentsQuery,
  type ReturnItAsset,
  type TransferItAsset,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { toItAssetAssignmentDto, toItAssetDto, toItAssetHistoryEntryDto } from '../it.mappers';
import { itAssetCustodyService } from './custody.service';
import { itAssetAssignmentService } from './assignment.service';

type IdParam = { id: string };

/** Custody writes are gated on `itAsset.assign`; the SCOPE still comes from the read grant. */
const custodyScope = (req: Request) => scopeSelector(authContext(req), 'itAsset.view');

export const assignItAsset = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AssignItAsset, never, IdParam>(req);
  const ctx = authContext(req);
  const { asset } = await itAssetCustodyService.assign(params.id, body, ctx, custodyScope(req));
  ok(res, toItAssetDto(asset));
};

export const returnItAsset = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ReturnItAsset, never, IdParam>(req);
  const ctx = authContext(req);
  const { asset } = await itAssetCustodyService.returnAsset(
    params.id,
    body,
    ctx,
    custodyScope(req),
  );
  ok(res, toItAssetDto(asset));
};

export const transferItAsset = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<TransferItAsset, never, IdParam>(req);
  const ctx = authContext(req);
  const { asset } = await itAssetCustodyService.transfer(params.id, body, ctx, custodyScope(req));
  ok(res, toItAssetDto(asset));
};

export const disposeItAsset = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<DisposeItAsset, never, IdParam>(req);
  const ctx = authContext(req);
  ok(
    res,
    toItAssetDto(await itAssetCustodyService.dispose(params.id, body, ctx, custodyScope(req))),
  );
};

export const listItAssetHistory = async (req: Request, res: Response): Promise<void> => {
  const { params, query } = validated<never, ListItAssetHistoryQuery, IdParam>(req);
  const page = await itAssetCustodyService.history(params.id, query, custodyScope(req));
  okPage(res, page, toItAssetHistoryEntryDto);
};

export const listItAssetAssignments = async (req: Request, res: Response): Promise<void> => {
  const { params, query } = validated<never, ListItAssignmentsQuery, IdParam>(req);
  const page = await itAssetAssignmentService.listForAsset(params.id, query, custodyScope(req));
  okPage(res, page, toItAssetAssignmentDto);
};

/** The cross-asset custody register — "what is out, and who has it". */
export const listItAssignments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItAssignmentsQuery>(req);
  const page = await itAssetAssignmentService.list(query, custodyScope(req));
  okPage(res, page, toItAssetAssignmentDto);
};
