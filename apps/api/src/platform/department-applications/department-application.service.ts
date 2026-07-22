import { Types } from 'mongoose';
import { type ApplicationDto } from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/errors';
import { auditService } from '../audit';
// Leaf-repository imports (not barrels) — avoids service import cycles.
import { departmentRepository } from '../organization/departments/department.repository';
import { applicationRepository } from '../applications/application.repository';
import { applicationService } from '../applications/application.service';
import { type ApplicationDoc } from '../applications/application.model';
import { departmentApplicationRepository } from './department-application.repository';

const departmentRef = (departmentId: string) => ({
  moduleId: 'platform',
  entityType: 'department',
  entityId: departmentId,
});

class DepartmentApplicationService {
  /** Assign an application to a department. Both must exist and be active; duplicates are rejected. */
  async assign(departmentId: string, applicationId: string, by: string): Promise<ApplicationDoc> {
    const department = await departmentRepository.findById(departmentId);
    if (department === null || department.status !== 'active') {
      throw new BusinessRuleError('Department must exist and be active');
    }
    const application = await applicationRepository.findById(applicationId);
    if (application === null || application.status !== 'active') {
      throw new BusinessRuleError('Application must exist and be active');
    }
    const existing = await departmentApplicationRepository.findOne({
      departmentId: new Types.ObjectId(departmentId),
      applicationId: new Types.ObjectId(applicationId),
    });
    if (existing !== null) {
      throw new ConflictError('Application is already assigned to this department');
    }
    await departmentApplicationRepository.create(
      {
        departmentId: new Types.ObjectId(departmentId),
        applicationId: new Types.ObjectId(applicationId),
      },
      { by },
    );
    await auditService.record({
      entityRef: departmentRef(departmentId),
      action: 'update',
      changes: [{ field: 'applications', old: null, new: applicationId }],
    });
    return application;
  }

  /** Remove an assignment. Deletes only the link — never the department or the application. */
  async remove(departmentId: string, applicationId: string, by: string): Promise<void> {
    const existing = await departmentApplicationRepository.findOne({
      departmentId: new Types.ObjectId(departmentId),
      applicationId: new Types.ObjectId(applicationId),
    });
    if (existing === null) {
      throw new NotFoundError('Application is not assigned to this department');
    }
    await departmentApplicationRepository.softDeleteById(String(existing._id), { by });
    await auditService.record({
      entityRef: departmentRef(departmentId),
      action: 'update',
      changes: [{ field: 'applications', old: applicationId, new: null }],
    });
  }

  /** The applications currently assigned to a department (assignment order preserved). */
  async listApplications(departmentId: string): Promise<ApplicationDto[]> {
    const assignments = await departmentApplicationRepository.findByDepartment(departmentId);
    const applications = await Promise.all(
      assignments.map((a) => applicationRepository.findById(String(a.applicationId))),
    );
    return applications
      .filter((a): a is ApplicationDoc => a !== null)
      .map((a) => applicationService.toDto(a));
  }
}

export const departmentApplicationService = new DepartmentApplicationService();
