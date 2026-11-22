// The employee each file belongs to — name, photo, job, department, hire date — for the
// «ملفات الموظفين» folders. Read in three batched queries for a whole page, never one per row.
import { Types } from 'mongoose';
import { type EmployeeFileDto, type EmployeeFileOwnerDto } from '@ecms/contracts';
import { EmployeeModel } from '../employees/employee.model';
import { JobTitleModel } from '../../../../platform/organization/job-titles/job-title.model';
import { DepartmentModel } from '../../../../platform/organization/departments/department.model';

type Named = { _id: Types.ObjectId; name: { ar: string; en: string } };

export const attachOwners = async (files: EmployeeFileDto[]): Promise<EmployeeFileDto[]> => {
  const ids = [...new Set(files.map((f) => f.employeeId))].filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) return files;
  const people = await EmployeeModel.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
    .select({ 'personal.fullNameAr': 1, 'personal.fullNameEn': 1, 'personal.photoFileId': 1, employment: 1, hiredAt: 1, status: 1 })
    .lean()
    .exec();
  const [titles, departments] = await Promise.all([
    JobTitleModel.find({ _id: { $in: people.map((p) => p.employment.jobTitleId) } }).select({ name: 1 }).lean<Named[]>().exec(),
    DepartmentModel.find({ _id: { $in: people.map((p) => p.employment.departmentId) } }).select({ name: 1 }).lean<Named[]>().exec(),
  ]);
  const title = new Map(titles.map((x) => [String(x._id), x.name]));
  const dept = new Map(departments.map((x) => [String(x._id), x.name]));
  const owner = new Map<string, EmployeeFileOwnerDto>(
    people.map((p) => [
      String(p._id),
      {
        nameAr: p.personal.fullNameAr,
        nameEn: p.personal.fullNameEn ?? null,
        photoFileId: p.personal.photoFileId === null || p.personal.photoFileId === undefined ? null : String(p.personal.photoFileId),
        jobTitle: title.get(String(p.employment.jobTitleId)) ?? null,
        department: dept.get(String(p.employment.departmentId)) ?? null,
        hiredAt: p.hiredAt instanceof Date ? p.hiredAt.toISOString() : null,
        status: p.status,
      },
    ]),
  );
  return files.map((f) => ({ ...f, owner: owner.get(f.employeeId) ?? null }));
};
