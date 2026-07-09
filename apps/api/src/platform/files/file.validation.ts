// Zod schemas re-exported from packages/contracts (shared with the frontend).
export {
  UploadFileFieldsSchema,
  UpdateFileSchema,
  ListFilesQuerySchema,
  CreateFileCategorySchema,
  UpdateFileCategorySchema,
  PaginationQuerySchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const FileIdParamSchema = z.object({ id: objectId() }).strict();

export const SignedQuerySchema = z
  .object({
    e: z.coerce.number().int(),
    s: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
