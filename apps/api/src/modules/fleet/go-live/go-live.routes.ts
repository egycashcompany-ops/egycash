// `GET /fleet/go-live` — what the boot-time go-live steps did, read off their own rows.
//
// The owner cannot read the server log. Two production imports claimed their mark, wrote every
// dropdown and no car, and the only account of why was a log line nobody could reach — so the
// steps now write what they found on `fleet_go_live_runs`, and this is the door to it. Read-only;
// nothing here starts, retries or resets a run, because a run that needs any of those is a code
// change somebody reviews.
//
// `authorizeAny` over the two WRITE grants the steps themselves act under: whoever may create a
// vehicle or manage a driver is who acts on «the import refused because branch X is inactive».
import { Router } from 'express';
import { type Request, type Response } from 'express';
import { type FleetGoLiveRunDto, type FleetGoLiveRunsDto } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorizeAny } from '../../../platform/rbac';
import { asyncHandler, ok } from '../../../platform/web';
import { FleetGoLiveRunModel, type FleetGoLiveRunDoc } from './go-live-run.model';

const toDto = (doc: FleetGoLiveRunDoc): FleetGoLiveRunDto => ({
  key: doc.key,
  status: doc.status,
  startedAt: doc.startedAt.toISOString(),
  finishedAt: doc.finishedAt === null ? null : doc.finishedAt.toISOString(),
  leaseUntil: doc.leaseUntil.toISOString(),
  outcome: doc.outcome,
});

export const listGoLiveRuns = async (_req: Request, res: Response): Promise<void> => {
  const docs = await FleetGoLiveRunModel.find({}).sort({ key: 1 }).lean<FleetGoLiveRunDoc[]>().exec();
  const body: FleetGoLiveRunsDto = { runs: docs.map(toDto) };
  ok(res, body);
};

export const buildFleetGoLiveRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny('fleetVehicle.create', 'fleetDriver.manage'),
    asyncHandler(listGoLiveRuns),
  );
  return router;
};
