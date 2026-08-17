// Thin HTTP mapping only (ADR-003). Note what is NOT here: no captain parameter. The identity
// comes from the token via the service, so there is no id for a client to tamper with.
import { type Request, type Response } from 'express';
import { type OperationsMobileDayQuery } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { operationsMobileService } from './mobile.service';

export const getMyDay = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsMobileDayQuery>(req);
  ok(res, await operationsMobileService.myDay(authContext(req).userId, query.date));
};
