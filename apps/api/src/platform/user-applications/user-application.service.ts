import { Types } from 'mongoose';
import { type ApplicationDto } from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/errors';
import { auditService } from '../audit';
// Leaf-repository imports (not barrels) — avoids service import cycles.
import { userRepository } from '../users/user.repository';
import { applicationRepository } from '../applications/application.repository';
import { applicationService } from '../applications/application.service';
import { type ApplicationDoc } from '../applications/application.model';
import { userApplicationRepository } from './user-application.repository';

const userRef = (userId: string) => ({
  moduleId: 'platform',
  entityType: 'user',
  entityId: userId,
});

class UserApplicationService {
  /** Assign an application directly to a user. Both must exist and be active; duplicates rejected. */
  async assign(userId: string, applicationId: string, by: string): Promise<ApplicationDoc> {
    const user = await userRepository.findById(userId);
    if (user === null || user.status !== 'active') {
      throw new BusinessRuleError('User must exist and be active');
    }
    const application = await applicationRepository.findById(applicationId);
    if (application === null || application.status !== 'active') {
      throw new BusinessRuleError('Application must exist and be active');
    }
    const existing = await userApplicationRepository.findOne({
      userId: new Types.ObjectId(userId),
      applicationId: new Types.ObjectId(applicationId),
    });
    if (existing !== null) {
      throw new ConflictError('Application is already assigned to this user');
    }
    await userApplicationRepository.create(
      {
        userId: new Types.ObjectId(userId),
        applicationId: new Types.ObjectId(applicationId),
      },
      { by },
    );
    await auditService.record({
      entityRef: userRef(userId),
      action: 'update',
      changes: [{ field: 'applications', old: null, new: applicationId }],
    });
    return application;
  }

  /** Remove an assignment. Deletes only the link — never the user or the application. */
  async remove(userId: string, applicationId: string, by: string): Promise<void> {
    const existing = await userApplicationRepository.findOne({
      userId: new Types.ObjectId(userId),
      applicationId: new Types.ObjectId(applicationId),
    });
    if (existing === null) {
      throw new NotFoundError('Application is not assigned to this user');
    }
    await userApplicationRepository.softDeleteById(String(existing._id), { by });
    await auditService.record({
      entityRef: userRef(userId),
      action: 'update',
      changes: [{ field: 'applications', old: applicationId, new: null }],
    });
  }

  /** The applications directly assigned to a user. */
  async listApplications(userId: string): Promise<ApplicationDto[]> {
    const assignments = await userApplicationRepository.findByUser(userId);
    const applications = await Promise.all(
      assignments.map((a) => applicationRepository.findById(String(a.applicationId))),
    );
    return applications
      .filter((a): a is ApplicationDoc => a !== null)
      .map((a) => applicationService.toDto(a));
  }
}

export const userApplicationService = new UserApplicationService();
