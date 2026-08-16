// HR side of the platform shift-label seam (P-HR-22, D-JOB-6 option C).
//
// The Job catalog lives in `platform` and may not import this module, so the reader registers
// here at module load — the same shape `employee-management/employees/identity-seams.ts` uses for
// employee-code login, and for the same boundary reason.
//
// A NAME IS ALL THAT CROSSES. Not the times, not the grace minutes, not `active`, not the doc.
// The platform screen asks "what is this shift called?" and gets an answer to exactly that; every
// other fact about a shift stays behind `attendance.manageShifts` where it already was. Widening
// this file is the only way to widen what the Job screen can see, and the file is one query long.
import { registerShiftLabelReader } from '../../../../platform/organization/shift-label-seams';
import { ShiftModel } from './shift.model';

export const registerHrShiftLabelSeam = (): void => {
  registerShiftLabelReader(async (ids) => {
    const rows = await ShiftModel.find({ _id: { $in: [...ids] }, isDeleted: false })
      .select({ name: 1 })
      .lean<{ _id: unknown; name: { ar: string; en: string } }[]>()
      .exec();
    return new Map(rows.map((row) => [String(row._id), row.name]));
  });
};
