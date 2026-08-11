// Resolves the caller's *effective* applications: **the applications their effective permissions
// entitle them to**, grouped for the sidebar.
//
// THE MODEL THIS REPLACES. Navigation used to be the union of two grant tables — the applications
// assigned to the caller's department and those granted to them directly — intersected with their
// permissions. A role therefore wrote only half of what the sidebar needed: assign someone every
// permission a module has and their sidebar stayed empty until an administrator ALSO granted them
// the application, on a second screen, by hand. Two records had to agree for a screen to appear, and
// nothing kept them in step: revoking a role left the grant behind, and granting an application to
// somebody who could not open it produced a row that 403'd on click.
//
// Now there is one source. An application declares the permission that opens it (`permissionKey`);
// the caller's effective permissions decide which of those they hold; navigation is the answer. It
// follows automatically from every RBAC change — assigning or revoking a role, editing a role's
// permissions, a validity window opening or closing — because those are exactly the events that
// change an effective permission set, and this reads that set rather than a copy of it.
//
// FAIL-CLOSED ON NULL. An application with no `permissionKey` is entitled to NOBODY. Under the old
// model null meant "no permission needed" and was harmless, because a grant was still required to
// see the row at all; with grants gone, that reading would turn every undeclared application into
// one visible to every signed-in user. The safe reading of "nobody declared who may open this" is
// "not yet anybody" — a missing row is a fixable omission, a leaked screen is an incident.
//
// Catalog repositories are read directly (not their services), which keeps this a leaf and avoids a
// service import cycle.
import { type MyApplicationCategoryDto, type DataScope } from '@ecms/contracts';
import { applicationRepository } from '../applications/application.repository';
import { applicationCategoryRepository } from '../application-categories/application-category.repository';
import {
  assembleEffectiveApplications,
  type EffectiveAppInput,
  type EffectiveCategoryInput,
} from './effective-applications';

class MeApplicationsService {
  /**
   * `permissions` is the caller's effective set, already resolved and cached by the RBAC service —
   * so navigation inherits that cache and its invalidation rather than keeping one of its own.
   */
  async listEffective(permissions: Record<string, DataScope>): Promise<MyApplicationCategoryDto[]> {
    // The catalog is asked only for what this caller could possibly be entitled to.
    const apps = await applicationRepository.findByPermissionKeys(Object.keys(permissions));

    // Load only the categories those applications reference.
    const categoryIds = new Set(apps.map((app) => String(app.categoryId)));
    const categories = (
      await Promise.all([...categoryIds].map((id) => applicationCategoryRepository.findById(id)))
    ).filter((category): category is NonNullable<typeof category> => category !== null);

    const appInputs: EffectiveAppInput[] = apps.map((app) => ({
      id: String(app._id),
      name: app.name,
      icon: app.icon,
      route: app.route,
      sortOrder: app.sortOrder,
      status: app.status,
      categoryId: String(app.categoryId),
      permissionKey: app.permissionKey ?? null,
    }));
    const categoryInputs: EffectiveCategoryInput[] = categories.map((category) => ({
      id: String(category._id),
      name: category.name,
      icon: category.icon,
      sortOrder: category.sortOrder,
    }));

    return assembleEffectiveApplications(appInputs, categoryInputs, permissions);
  }
}

export const meApplicationsService = new MeApplicationsService();
