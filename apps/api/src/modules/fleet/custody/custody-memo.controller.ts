// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateFleetCustodyMemo,
  type FleetCustodyMemoCandidatesQuery,
  type FleetCustodyMemoSummaryQuery,
  type ListFleetCustodyMemosQuery,
  type UpdateFleetCustodyMemo,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { fleetCustodyMemoService } from './custody-memo.service';

type IdParam = { id: string };

export const listCustodyMemos = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetCustodyMemosQuery>(req);
  okPage(res, await fleetCustodyMemoService.list(query), (row) => row);
};

export const custodyMemoSummary = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetCustodyMemoSummaryQuery>(req);
  ok(res, await fleetCustodyMemoService.summary(query));
};

export const custodyMemosOutside = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await fleetCustodyMemoService.outside());
};

export const custodyMemoCandidates = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetCustodyMemoCandidatesQuery>(req);
  ok(res, await fleetCustodyMemoService.candidates(query));
};

export const getCustodyMemo = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await fleetCustodyMemoService.get(params.id));
};

export const createCustodyMemo = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetCustodyMemo>(req);
  created(res, await fleetCustodyMemoService.create(body, authContext(req).userId));
};

export const updateCustodyMemo = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetCustodyMemo, never, IdParam>(req);
  ok(res, await fleetCustodyMemoService.update(params.id, body, authContext(req).userId));
};

export const deleteCustodyMemo = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetCustodyMemoService.remove(params.id, authContext(req).userId);
  noContent(res);
};
