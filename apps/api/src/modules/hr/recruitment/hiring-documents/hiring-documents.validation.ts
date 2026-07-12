// Zod schemas re-exported from packages/contracts (shared with the frontend), plus
// route-local param schemas. The module validates every boundary (ADR-007).
export {
  CreateHiringDocumentsSchema,
  UploadHiringDocumentSchema,
  ReplaceHiringDocumentSchema,
  CompleteHiringDocumentsSchema,
  ListHiringDocumentsQuerySchema,
  CreateHiringDocumentTypeSchema,
  UpdateHiringDocumentTypeSchema,
  ListHiringDocumentTypesQuerySchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const HiringDocumentsIdParamSchema = z.object({ id: objectId() }).strict();
export const HiringDocumentTypeParamSchema = z.object({ id: objectId(), typeId: objectId() }).strict();
