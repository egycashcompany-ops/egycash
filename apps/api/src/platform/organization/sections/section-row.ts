// The parent-derived fields of a section row (P-ORG-3 §5.4), pure: the section service builds a row
// with it after its own reads and checks, and the org chart builds rows in N branches inside one
// transaction with it — so the two can never disagree about where a section row hangs.
import { type Types } from 'mongoose';

export const sectionRowFields = (
  department: { _id: Types.ObjectId; branchId: Types.ObjectId },
  catalogId: Types.ObjectId | null,
  id: Types.ObjectId,
): { branchId: Types.ObjectId; departmentId: Types.ObjectId; catalogId: Types.ObjectId | null; path: string } => ({
  branchId: department.branchId,
  departmentId: department._id,
  catalogId,
  path: `${String(department.branchId)}/${String(department._id)}/${String(id)}`,
});
