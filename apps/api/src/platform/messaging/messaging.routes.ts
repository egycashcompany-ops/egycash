// /platform/messaging — «الرسائل التلقائية» on /system/messaging. The keys the system settings
// screen already uses: `setting.view` reads, `setting.edit` writes (and, in the service, only when
// held company-wide). The test sends a real SMS that costs money, so it is limited per person.
import { Router, type Request, type Response } from 'express';
import {
  TestSmsSchema,
  UpdateMessagingSettingsSchema,
  type TestSms,
  type UpdateMessagingSettings,
} from '@ecms/contracts';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { ok } from '../../infrastructure/http/respond';
import { validate, validated } from '../../infrastructure/http/validate';
import { rateLimit } from '../../infrastructure/redis/rate-limiter';
import { authContext, authContextOrNull, authenticate } from '../auth';
import { authorize } from '../rbac';
import { messagingService } from './messaging.service';

/** Tests per person per minute — enough to fix a typo and try again, not a way to send SMS. */
export const SMS_TEST_LIMIT_PER_MINUTE = 5;

const perUser = (req: Request): string | null => authContextOrNull(req)?.userId ?? null;

const getSettings = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await messagingService.getSettings());
};

const updateSettings = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<UpdateMessagingSettings>(req);
  ok(res, await messagingService.updateSettings(body, authContext(req)));
};

const testSms = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<TestSms>(req);
  ok(res, await messagingService.testSms(body.phone, authContext(req)));
};

export const buildMessagingRouter = (): Router => {
  const router = Router();
  router.get('/settings', authenticate, authorize('setting.view'), asyncHandler(getSettings));
  router.patch(
    '/settings',
    authenticate,
    authorize('setting.edit'),
    validate({ body: UpdateMessagingSettingsSchema }),
    asyncHandler(updateSettings),
  );
  router.post(
    '/sms/test',
    authenticate,
    authorize('setting.edit'),
    rateLimit({
      name: 'messaging-sms-test',
      windowSeconds: 60,
      max: SMS_TEST_LIMIT_PER_MINUTE,
      keyOf: perUser,
    }),
    validate({ body: TestSmsSchema }),
    asyncHandler(testSms),
  );
  return router;
};
