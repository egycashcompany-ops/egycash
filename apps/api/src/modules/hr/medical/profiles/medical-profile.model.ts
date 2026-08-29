// One employee's health profile (P-HR-MED D3, D4, D6, D12).
//
// NO `branchId` AND NO `departmentId`, AND THAT IS THE DECISION — not an oversight, and the exact
// opposite of what every other collection carrying a person in this codebase declares.
//
// Everywhere else, a missing scope field is the defect: `BaseRepository.scopeFilter` answers an
// undeclared field with an EMPTY filter, `baseFilter` drops the empty clause, and a
// department-scoped reader is served the whole organization. Four guards exist to catch exactly
// that, and it has been caught four times.
//
// Here, declaring the axes would be the defect. A scope WIDENS: an organization-scoped HR officer
// would gain everybody's blood type by holding a key meant to gate rather than to grant, and a
// branch-scoped one would gain their branch's. The permission is the gate (D3); the axis is not
// (D4). `medical-visibility.spec.ts` holds this in source, and says so where somebody «fixing» it
// will read it first.
//
// NO FITNESS VERDICT HERE (D6, D7): «fit», «fit with restrictions», «unfit» is a clinical statement
// about a MOMENT and is therefore an EVENT (M3). Stored on the profile it would be one doctor's
// opinion from one date presented as a standing fact about a person.
import { Schema, model, type Types } from 'mongoose';
import { BLOOD_TYPES, type BloodType } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface MedicalProfileDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  /**
   * The name and code, copied for the one screen that shows this beside a person.
   *
   * A CACHE, not a snapshot: unlike a training record or a finalized review, a health profile is
   * about somebody who still exists and whose name being corrected should correct here too. There
   * is nothing historical about a blood type.
   */
  employeeCode: string;
  employeeName: string;
  bloodType: BloodType | null;
  /** Text, never codes (D12) — what the employee told their HR officer, in their words. */
  chronicConditions: string[];
  allergies: string[];
  hasDisability: boolean;
  disabilityNote: string | null;
  note: string | null;
}

const medicalProfileSchema = new Schema<MedicalProfileDoc>(
  {
    ...baseFields,
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    employeeName: { type: String, required: true },
    bloodType: { type: String, enum: [...BLOOD_TYPES, null], default: null },
    chronicConditions: { type: [String], default: [] },
    allergies: { type: [String], default: [] },
    hasDisability: { type: Boolean, required: true, default: false },
    disabilityNote: { type: String, default: null },
    note: { type: String, default: null },
  },
  baseSchemaOptions,
);

// ONE PROFILE PER PERSON. Two would each claim to be what is true of the same body, and the second
// reader would get whichever the query reached first.
medicalProfileSchema.index(
  { employeeId: 1 },
  { unique: true, name: 'ux_employee', partialFilterExpression: { isDeleted: false } },
);

// NO INDEX ON `chronicConditions`, `allergies` OR `hasDisability`, deliberately. An index is what a
// search is built on, and «who here is diabetic» has no legitimate HR answer — offering the query
// would make this a screening tool. The only way in is to name the person (D12, D13).

export const MedicalProfileModel = model<MedicalProfileDoc>(
  'HrMedicalProfile',
  medicalProfileSchema,
  'hr_medical_profiles',
);
