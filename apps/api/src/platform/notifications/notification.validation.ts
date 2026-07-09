// Zod schemas re-exported from packages/contracts (shared with the frontend), plus
// route-local param schemas.
export {
  CreateNotificationTemplateSchema,
  ListNotificationsQuerySchema,
  ListNotificationTemplatesQuerySchema,
  PreviewNotificationTemplateSchema,
  TestSendNotificationTemplateSchema,
  UpdateNotificationTemplateSchema,
  UpsertNotificationPreferenceSchema,
  UpsertQuietHoursSchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const NotificationIdParamSchema = z.object({ id: objectId() }).strict();
export const TemplateIdParamSchema = z.object({ id: objectId() }).strict();
