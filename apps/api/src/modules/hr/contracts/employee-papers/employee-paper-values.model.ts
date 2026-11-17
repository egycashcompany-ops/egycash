// A28 — «تعديل» on an EMPLOYEE's «طباعة العقد والمستندات» tab: the values typed in for their papers.
//
// «في شاشه الموظفين لما بندخل علي شخص و عاوزين نطبعلو حاجه … نخلي في امكانيه للتعديل زي معملنا قبل
// كدا». One record per employee, made at the first change: what was typed in for them (an address,
// the subscription's start date…), used by every paper of theirs that prints the same value, on their
// tab and in «المعينون»'s printing for many. Their file never changes; the contract they hold is
// printed as issued.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface EmployeePaperValuesDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  overrides: { key: string; value: string }[];
}

const employeePaperValuesSchema = new Schema<EmployeePaperValuesDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    overrides: {
      type: [{ _id: false, key: { type: String, required: true }, value: { type: String, default: '' } }],
      default: [],
    },
    ...baseFields,
  },
  baseSchemaOptions,
);

employeePaperValuesSchema.index(
  { employeeId: 1 },
  { unique: true, name: 'ux_employee', partialFilterExpression: { isDeleted: false } },
);

export const EmployeePaperValuesModel = model<EmployeePaperValuesDoc>(
  'HrEmployeePaperValues',
  employeePaperValuesSchema,
  'hr_employee_paper_values',
);
