// Organization module route subtree (lazy-loaded as one chunk — route-based code splitting per
// Software Architecture §6). The layout route provides the shell; every screen is permission-gated.
// Branch/Department/Section reuse the generic Unit* screens (configured per unit); Job Titles and
// the Company profile have their own screens. Default export so React.lazy can import it.
import { Outlet, Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { OrganizationLayout } from './OrganizationLayout';
import { OrganizationOverview } from './pages/OrganizationOverview';
import { CompanyPage } from './company/CompanyPage';
import { UnitListPage } from './shared/UnitListPage';
import { UnitDetailPage } from './shared/UnitDetailPage';
import { UnitFormPage } from './shared/UnitFormPage';
import { branchConfig, departmentConfig, sectionConfig } from './shared/unit-config';
import { BranchesListPage } from './branches/pages/BranchesListPage';
import { BranchDetailPage } from './branches/pages/BranchDetailPage';
import { JobTitlesListPage } from './job-titles/pages/JobTitlesListPage';
import { JobTitleDetailPage } from './job-titles/pages/JobTitleDetailPage';
import { JobTitleFormPage } from './job-titles/pages/JobTitleFormPage';

export default function OrganizationRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<OrganizationLayout />}>
        <Route index element={<OrganizationOverview />} />

        <Route
          path="company"
          element={
            <RequirePermission permission="organization.view">
              <CompanyPage />
            </RequirePermission>
          }
        />

        <Route
          path="branches"
          element={
            <RequirePermission permission="branch.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<BranchesListPage />} />
          <Route
            path="new"
            element={
              <RequirePermission permission="branch.create">
                <UnitFormPage config={branchConfig} mode="create" />
              </RequirePermission>
            }
          />
          <Route path=":id" element={<BranchDetailPage />} />
          <Route
            path=":id/edit"
            element={
              <RequirePermission permission="branch.edit">
                <UnitFormPage config={branchConfig} mode="edit" />
              </RequirePermission>
            }
          />
        </Route>

        <Route
          path="departments"
          element={
            <RequirePermission permission="department.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<UnitListPage config={departmentConfig} />} />
          <Route
            path="new"
            element={
              <RequirePermission permission="department.create">
                <UnitFormPage config={departmentConfig} mode="create" />
              </RequirePermission>
            }
          />
          <Route path=":id" element={<UnitDetailPage config={departmentConfig} />} />
          <Route
            path=":id/edit"
            element={
              <RequirePermission permission="department.edit">
                <UnitFormPage config={departmentConfig} mode="edit" />
              </RequirePermission>
            }
          />
        </Route>

        <Route
          path="sections"
          element={
            <RequirePermission permission="section.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<UnitListPage config={sectionConfig} />} />
          <Route
            path="new"
            element={
              <RequirePermission permission="section.create">
                <UnitFormPage config={sectionConfig} mode="create" />
              </RequirePermission>
            }
          />
          <Route path=":id" element={<UnitDetailPage config={sectionConfig} />} />
          <Route
            path=":id/edit"
            element={
              <RequirePermission permission="section.edit">
                <UnitFormPage config={sectionConfig} mode="edit" />
              </RequirePermission>
            }
          />
        </Route>

        <Route
          path="job-titles"
          element={
            <RequirePermission permission="jobTitle.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<JobTitlesListPage />} />
          <Route
            path="new"
            element={
              <RequirePermission permission="jobTitle.create">
                <JobTitleFormPage mode="create" />
              </RequirePermission>
            }
          />
          <Route path=":id" element={<JobTitleDetailPage />} />
          <Route
            path=":id/edit"
            element={
              <RequirePermission permission="jobTitle.edit">
                <JobTitleFormPage mode="edit" />
              </RequirePermission>
            }
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
