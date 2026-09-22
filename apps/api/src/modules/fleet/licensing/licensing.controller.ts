// Thin HTTP mapping only (ADR-003). The tick answers with the refreshed board, because the two
// halves of a pair colour together and a screen that patched one square in hand would have to
// know that rule twice.
import { type Request, type Response } from 'express';
import { type SetFleetLicensingMark } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { fleetLicensingService } from './licensing.service';

export const getLicensingBoard = async (req: Request, res: Response): Promise<void> => {
  const scope = scopeSelector(authContext(req), 'fleetLicensing.view');
  ok(res, await fleetLicensingService.board(scope));
};

export const setLicensingMark = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SetFleetLicensingMark>(req);
  const ctx = authContext(req);
  const scope = scopeSelector(ctx, 'fleetLicensing.mark');
  await fleetLicensingService.setMark(body, ctx.userId, scope);
  ok(res, await fleetLicensingService.board(scopeSelector(ctx, 'fleetLicensing.view')));
};
