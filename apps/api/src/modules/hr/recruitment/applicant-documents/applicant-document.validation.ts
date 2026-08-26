// Route-shaped schemas. The bodies come from `@ecms/contracts`; what lives here is the params
// and the multipart-flavoured query, exactly as `hiring-documents.validation.ts` splits them.
import { z } from 'zod';
import { objectId } from '@ecms/contracts';

/** The staff routes address a candidate; the portal routes address nobody — see the router. */
export const ApplicantParamSchema = z.object({ applicantId: objectId() }).strict();

export const ApplicantDocumentParamSchema = z
  .object({ applicantId: objectId(), typeId: objectId() })
  .strict();

/** The portal's own replace/review target: only the slot, because the person is the session. */
export const PortalDocumentParamSchema = z.object({ typeId: objectId() }).strict();

export const ApplicantDocumentTypeParamSchema = z.object({ id: objectId() }).strict();
