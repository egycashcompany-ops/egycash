import { Router } from 'express';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { authenticate } from '../auth';
import { getMyApplications } from './me.controller';

// Mounted at `/platform/me` — the signed-in user's own resources. `authenticate` only: the data is
// scoped to the caller by definition, so no permission gate is applied.
export const buildMeRouter = (): Router => {
  const router = Router();
  router.get('/applications', authenticate, asyncHandler(getMyApplications));
  return router;
};
