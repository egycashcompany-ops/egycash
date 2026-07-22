import { z } from 'zod';
import { objectId } from '../common/index.js';

// Department ↔ Applications assignment (many-to-many). A department consumes applications; assigning
// or removing an assignment never affects the department or the application entity itself. The list
// of assigned applications is returned as `ApplicationDto[]` (see application.ts).
export const AssignApplicationSchema = z.object({ applicationId: objectId() }).strict();
export type AssignApplication = z.infer<typeof AssignApplicationSchema>;
