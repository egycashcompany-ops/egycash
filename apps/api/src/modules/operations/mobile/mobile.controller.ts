// Thin HTTP mapping only (ADR-003). Note what is NOT here: no captain parameter. The identity
// comes from the token via the service, so there is no id for a client to tamper with.
import { type Request, type Response } from 'express';
import {
  type OperationsExecutionBody,
  type OperationsExecutionParams,
  type OperationsMobileDayQuery,
} from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { operationsMobileService } from './mobile.service';
import { operationsExecutionService } from './execution.service';

export const getMyDay = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsMobileDayQuery>(req);
  ok(res, await operationsMobileService.myDay(authContext(req).userId, query.date));
};

/**
 * The four execution acts. Each is the same thin shape: who (from the token), which stop (from the
 * path), and nothing else — no captain, no sequence, no order, no coordinates.
 */
const act =
  (
    run: (
      userId: string,
      assignmentId: string,
      body: OperationsExecutionBody,
      by: string,
    ) => Promise<unknown>,
  ) =>
  async (req: Request, res: Response): Promise<void> => {
    const { body, params } = validated<OperationsExecutionBody, never, OperationsExecutionParams>(
      req,
    );
    const { userId } = authContext(req);
    ok(res, await run(userId, params.assignmentId, body, userId));
  };

export const startStop = act((...a) => operationsExecutionService.start(...a));
export const confirmStopPickup = act((...a) => operationsExecutionService.confirmPickup(...a));
export const confirmStopDelivery = act((...a) => operationsExecutionService.confirmDelivery(...a));
export const completeStop = act((...a) => operationsExecutionService.complete(...a));
