// Zod schemas re-exported from packages/contracts (shared with the frontend), plus
// route-local param schemas. The module validates every boundary (ADR-007).
export {
  RegisterApplicantSchema,
  UpdateApplicantSchema,
  ConfirmApplicantIdentitySchema,
  WithdrawApplicantSchema,
  RestoreApplicantSchema,
  ListApplicantsQuerySchema,
  ExportApplicantsQuerySchema,
  BulkApplicantsSchema,
  AddApplicantAttachmentSchema,
  OcrExtractNationalIdSchema,
  CreateApplicantSourceSchema,
  UpdateApplicantSourceSchema,
  ListApplicantSourcesQuerySchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const ApplicantIdParamSchema = z.object({ id: objectId() }).strict();
export const ApplicantAttachmentParamSchema = z
  .object({ id: objectId(), fileId: objectId() })
  .strict();
export const ApplicantSourceIdParamSchema = z.object({ id: objectId() }).strict();
