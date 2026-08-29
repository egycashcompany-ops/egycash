// الشؤون الطبية — الملف الصحي (P-HR-MED §3، القرارات D3، D4، D5، D12، D14).
//
// THIS IS THE MOST SENSITIVE COLLECTION IN THE SYSTEM, and the shape says so. Every other HR row
// answers «what did this person do»; this one answers «what is true of this person's body», which
// is a claim they may never see, cannot contest, and cannot take back once it has leaked.
//
// WHAT IS ABSENT ON PURPOSE:
//
//   • NO DIAGNOSIS CODE, no ICD, no clinical coding (D12). A coded diagnosis is a medical record
//     proper, and holding one makes the company a custodian of clinical data under a duty nobody
//     here has scoped. Conditions are TEXT, because text is what an HR department can honestly
//     hold and what a non-clinician can honestly read.
//   • NO EMERGENCY CONTACT (D6-b). It is not clinical, and putting it behind the medical key would
//     hide the number you call when somebody collapses from the supervisor standing over them. It
//     belongs on the employee record; §8 Q6 asks for it there.
//   • NO FITNESS VERDICT (D6, D7). «Fit», «fit with restrictions», «unfit» is a clinical statement
//     about a MOMENT, so it is an EVENT (M3) and not a property of a person. A verdict stored on
//     the profile would be a doctor's opinion from one date presented as a standing fact.
//   • NO EXPIRY, NO COMPLIANCE FLAG (D13). Nothing here counts anything.
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';

/**
 * Blood type — the one closed vocabulary in this file.
 *
 * Enumerable because it genuinely is a fixed set of eight, unlike conditions and allergies, which
 * are open text for the reason D12 gives. A dropdown here is not the codification D12 refuses; it
 * is the difference between «O+» and «O positive» and «او بوزيتيف» being three rows.
 */
export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const BloodTypeSchema = z.enum(BLOOD_TYPES);
export type BloodType = z.infer<typeof BloodTypeSchema>;

/**
 * The profile — ONE PER EMPLOYEE, and every field optional.
 *
 * Optional is a decision, not laziness: an HR department that knows somebody's blood type and
 * nothing else should be able to record that without inventing the rest, and a required field is
 * how «unknown» becomes «none» in a dataset somebody later trusts.
 */
export const UpsertMedicalProfileSchema = z
  .object({
    bloodType: BloodTypeSchema.nullable().optional(),
    /**
     * As written by whoever was told. NOT a coded list (D12) and not a diagnosis: «diabetic, on
     * medication» is what an employee tells their HR officer, and it is the honest shape of what
     * the company actually knows.
     */
    chronicConditions: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
    allergies: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
    /**
     * Disability, recorded as a fact and NOTHING ELSE.
     *
     * Egyptian law has a quota, and a quota is a rule with a number, a denominator and a reporting
     * obligation that nobody has stated here. Recording that somebody has a disability is holding
     * a fact they disclosed; COUNTING it against a target would be computing compliance from an
     * invented rule (D13), and the report would be one the company acts on.
     */
    hasDisability: z.boolean().optional(),
    disabilityNote: z.string().trim().max(1000).nullable().optional(),
    /** Anything the employee asked to be on file that the fields above have nowhere to put. */
    note: z.string().trim().max(2000).nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.hasDisability === false && (value.disabilityNote ?? '').trim() !== '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['disabilityNote'],
        message:
          'a note about a disability that is not recorded would outlive the fact it explains',
      });
    }
  });
export type UpsertMedicalProfile = z.infer<typeof UpsertMedicalProfileSchema>;

export interface MedicalProfileDto {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  bloodType: BloodType | null;
  chronicConditions: string[];
  allergies: string[];
  hasDisability: boolean;
  disabilityNote: string | null;
  note: string | null;
  updatedAt: string;
  version: number;
}

/**
 * The list query.
 *
 * NO SEARCH BY CONDITION, and its absence is D12 and D13 together: «who here is diabetic» is a
 * query with no legitimate HR answer, and offering it would make the module a screening tool. The
 * only way to reach a profile is to name the person — which is what somebody with a reason to look
 * already knows.
 */
export const ListMedicalProfilesQuerySchema = PaginationQuerySchema.extend({
  employeeId: objectId().optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListMedicalProfilesQuery = z.infer<typeof ListMedicalProfilesQuerySchema>;
