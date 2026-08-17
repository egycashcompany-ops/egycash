// The captain-facing surface. `operationsExecution.own` is the captain's own grant (design §16.2):
// it authorizes acting on YOUR OWN work, and the service pins "your own" to the token's employee.
// Holding it grants no visibility into anybody else's day, because no endpoint here takes a
// captain id at all.
import { Router, type Request, type Response } from 'express';
import {
  OperationsExecutionBodySchema,
  OperationsExecutionParamsSchema,
  OperationsMobileDayQuerySchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  completeStop,
  confirmStopDelivery,
  confirmStopPickup,
  getMyDay,
  startStop,
} from './mobile.controller';

export const buildOperationsMobileRouter = (): Router => {
  const router = Router();
  router.get(
    '/my-day',
    authenticate,
    authorize('operationsExecution.own'),
    validate({ query: OperationsMobileDayQuerySchema }),
    asyncHandler(getMyDay),
  );

  // OP-7 — the captain's four execution acts, in the order the machine allows them. The stop is
  // addressed by its ASSIGNMENT id; there is no captain segment anywhere in these paths, so the
  // same structural isolation that protects the read protects every mutation.
  const execute = (
    path: string,
    handler: (req: Request, res: Response) => Promise<void>,
  ): void => {
    router.post(
      `/stops/:assignmentId/${path}`,
      authenticate,
      authorize('operationsExecution.own'),
      validate({ params: OperationsExecutionParamsSchema, body: OperationsExecutionBodySchema }),
      asyncHandler(handler),
    );
  };
  execute('start', startStop);
  execute('pickup', confirmStopPickup);
  execute('deliver', confirmStopDelivery);
  execute('complete', completeStop);

  return router;
};
