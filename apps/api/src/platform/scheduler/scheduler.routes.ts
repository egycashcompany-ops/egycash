import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import { listTasks, pauseTask, resumeTask, runTaskNow } from './scheduler.controller';

const KeyParamSchema = z.object({ key: z.string().regex(/^[a-zA-Z0-9.-]+$/) }).strict();

export const buildScheduledTasksRouter = (): Router => {
  const router = Router();

  router.get('/', authenticate, authorize('scheduledTask.view'), asyncHandler(listTasks));
  router.post(
    '/:key/pause',
    authenticate,
    authorize('scheduledTask.manage'),
    validate({ params: KeyParamSchema }),
    asyncHandler(pauseTask),
  );
  router.post(
    '/:key/resume',
    authenticate,
    authorize('scheduledTask.manage'),
    validate({ params: KeyParamSchema }),
    asyncHandler(resumeTask),
  );
  router.post(
    '/:key/run',
    authenticate,
    authorize('scheduledTask.manage'),
    validate({ params: KeyParamSchema }),
    asyncHandler(runTaskNow),
  );
  return router;
};
