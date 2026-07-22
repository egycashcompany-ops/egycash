// Resolves the caller's *effective* applications: the union of the applications assigned to their
// department and the applications granted to them directly. Assignments are read through the leaf
// join repositories (already soft-delete filtered); the applications and their categories are loaded
// through the catalog repositories (also soft-delete filtered), then handed to the pure assembler for
// dedupe / active-only / grouping / ordering. Reading catalog repositories directly (not their
// services) keeps this a leaf and avoids a service import cycle.
import { type MyApplicationCategoryDto } from '@ecms/contracts';
import { applicationRepository } from '../applications/application.repository';
import { applicationCategoryRepository } from '../application-categories/application-category.repository';
import { departmentApplicationRepository } from '../department-applications/department-application.repository';
import { userApplicationRepository } from '../user-applications/user-application.repository';
import {
  assembleEffectiveApplications,
  type EffectiveAppInput,
  type EffectiveCategoryInput,
} from './effective-applications';

class MeApplicationsService {
  async listEffective(
    userId: string,
    departmentId: string | null,
  ): Promise<MyApplicationCategoryDto[]> {
    const [deptLinks, userLinks] = await Promise.all([
      departmentId === null
        ? Promise.resolve([])
        : departmentApplicationRepository.findByDepartment(departmentId),
      userApplicationRepository.findByUser(userId),
    ]);

    // Union of candidate application ids (dedupe happens again in the assembler after the
    // status filter, but collapsing here avoids redundant catalog reads).
    const applicationIds = new Set<string>([
      ...deptLinks.map((link) => String(link.applicationId)),
      ...userLinks.map((link) => String(link.applicationId)),
    ]);

    // Load the applications; findById is soft-delete filtered, so removed catalog entries drop out.
    const apps = (
      await Promise.all([...applicationIds].map((id) => applicationRepository.findById(id)))
    ).filter((app): app is NonNullable<typeof app> => app !== null);

    // Load only the categories those applications reference.
    const categoryIds = new Set(apps.map((app) => String(app.categoryId)));
    const categories = (
      await Promise.all(
        [...categoryIds].map((id) => applicationCategoryRepository.findById(id)),
      )
    ).filter((category): category is NonNullable<typeof category> => category !== null);

    const appInputs: EffectiveAppInput[] = apps.map((app) => ({
      id: String(app._id),
      name: app.name,
      icon: app.icon,
      route: app.route,
      sortOrder: app.sortOrder,
      status: app.status,
      categoryId: String(app.categoryId),
    }));
    const categoryInputs: EffectiveCategoryInput[] = categories.map((category) => ({
      id: String(category._id),
      name: category.name,
      icon: category.icon,
      sortOrder: category.sortOrder,
    }));

    return assembleEffectiveApplications(appInputs, categoryInputs);
  }
}

export const meApplicationsService = new MeApplicationsService();
