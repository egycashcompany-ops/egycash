// Zod schemas re-exported from packages/contracts (shared with the frontend), plus
// route-local param schemas. The module validates every boundary (ADR-007).
export {
  CreateScreeningSchema,
  AddScreeningNoteSchema,
  DecideScreeningSchema,
  ListScreeningsQuerySchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const ScreeningIdParamSchema = z.object({ id: objectId() }).strict();
