// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateFleetCustodyCharge,
  type CreateFleetCustodyReplenishment,
  type CreateFleetCustodySettlement,
  type FleetCustodyLedgerSummaryQuery,
  type ListFleetCustodyLedgerQuery,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { fleetCustodyFundService } from './custody-fund.service';

type IdParam = { id: string };

export const custodyFundSummary = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await fleetCustodyFundService.summary());
};

export const listCustodyLedger = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetCustodyLedgerQuery>(req);
  okPage(res, await fleetCustodyFundService.ledger(query), (row) => row);
};

export const custodyLedgerSummary = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetCustodyLedgerSummaryQuery>(req);
  ok(res, await fleetCustodyFundService.ledgerSummary(query));
};

export const custodyReplenishCandidates = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await fleetCustodyFundService.replenishCandidates());
};

export const custodySettleCandidates = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await fleetCustodyFundService.settleCandidates());
};

export const getCustodyOperation = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await fleetCustodyFundService.operation(params.id));
};

export const chargeCustody = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetCustodyCharge>(req);
  created(res, await fleetCustodyFundService.charge(body, authContext(req).userId));
};

export const replenishCustody = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetCustodyReplenishment>(req);
  created(res, await fleetCustodyFundService.replenish(body, authContext(req).userId));
};

export const settleCustody = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetCustodySettlement>(req);
  created(res, await fleetCustodyFundService.settle(body, authContext(req).userId));
};
