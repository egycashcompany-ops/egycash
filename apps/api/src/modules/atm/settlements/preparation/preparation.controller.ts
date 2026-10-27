// Thin HTTP mapping only (ADR-003) — /atm/preparation (docs/12-planning/atm-settlements-phase1.md
// §6.3 P1–P5).
import { type Request, type Response } from 'express';
import {
  type AtmSettlementDayQuery,
  type AtmVersion,
  type SaveAtmPreparation,
} from '@ecms/contracts';
import { authContext } from '../../../../platform/auth';
import { ok, validated } from '../../../../platform/web';
import { atmPreparationService } from './preparation.service';

export const getPreparationContext = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmSettlementDayQuery>(req);
  ok(res, await atmPreparationService.context(query, authContext(req)));
};

export const listPreparationLines = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { planId: string }>(req);
  ok(res, await atmPreparationService.lines(params.planId, authContext(req)));
};

export const savePreparation = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SaveAtmPreparation, never, { lineId: string }>(req);
  ok(res, await atmPreparationService.save(params.lineId, body, authContext(req)));
};

export const markPrepared = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AtmVersion, never, { lineId: string }>(req);
  ok(res, await atmPreparationService.prepared(params.lineId, body, authContext(req)));
};

export const reopenPreparation = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AtmVersion, never, { lineId: string }>(req);
  ok(res, await atmPreparationService.reopen(params.lineId, body, authContext(req)));
};
