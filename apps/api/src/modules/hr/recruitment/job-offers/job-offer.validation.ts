// Zod schemas re-exported from packages/contracts (shared with the frontend), plus
// route-local param schemas. The module validates every boundary (ADR-007).
export {
  CreateJobOfferSchema,
  ReviseJobOfferSchema,
  SendJobOfferSchema,
  AcceptJobOfferSchema,
  RejectJobOfferSchema,
  WithdrawJobOfferSchema,
  ListJobOffersQuerySchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const JobOfferIdParamSchema = z.object({ id: objectId() }).strict();
