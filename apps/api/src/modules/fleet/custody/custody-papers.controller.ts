// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type SaveFleetCustodyPaperSettings } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { fleetCustodyPapersService } from './custody-papers.service';

export const getCustodyPaperSettings = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await fleetCustodyPapersService.getSettings());
};

export const saveCustodyPaperSettings = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SaveFleetCustodyPaperSettings>(req);
  ok(res, await fleetCustodyPapersService.saveSettings(body, authContext(req).userId));
};
