import { type z } from 'zod';
import { booleanQuery, ListOrgUnitsQuerySchema as BaseListQuerySchema } from '@ecms/contracts';

export { CreateJobTitleSchema, UpdateJobTitleSchema } from '@ecms/contracts';

/**
 * The job-titles list query — the shared org-unit one plus the flag that DEFINES a driving seat.
 *
 * `requiresDrivingTest` is here rather than in the shared schema because it is the only org unit
 * that carries the flag: a branch does not require a driving test.
 *
 * It exists because a consumer that needs the driving seats had no way to ask for them. The fleet
 * drivers screen was reading one page of job titles and filtering the flag in the browser, so a
 * company with more than one page of them silently lost the seats that fell off the end — and with
 * them the narrowing that keeps the drivers filters under HR's page cap. Asking the question here
 * is bounded by the number of DRIVING titles, which is a handful, rather than by the catalogue.
 */
export const ListOrgUnitsQuerySchema = BaseListQuerySchema.extend({
  requiresDrivingTest: booleanQuery().optional(),
}).strict();
export type ListJobTitlesQuery = z.infer<typeof ListOrgUnitsQuerySchema>;
