// Contracts app route subtree (lazy-loaded). The register and detail live under
// contract.view; creation under contract.create; template administration (including
// the types catalog panel) under contractTemplate.manage — all server-enforced too.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { ContractsListPage } from './pages/ContractsListPage';
import { ContractCreatePage } from './pages/ContractCreatePage';
import { ContractDetailPage } from './pages/ContractDetailPage';
import { TemplatesListPage } from './pages/TemplatesListPage';
import { TemplateEditorPage } from './pages/TemplateEditorPage';

export default function ContractsRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <RequirePermission permission="contract.view">
              <ContractsListPage />
            </RequirePermission>
          }
        />
        <Route
          path="new"
          element={
            <RequirePermission permission="contract.create">
              <ContractCreatePage />
            </RequirePermission>
          }
        />
        <Route
          path="templates"
          element={
            <RequirePermission permission="contractTemplate.manage">
              <TemplatesListPage />
            </RequirePermission>
          }
        />
        <Route
          path="templates/new"
          element={
            <RequirePermission permission="contractTemplate.manage">
              <TemplateEditorPage />
            </RequirePermission>
          }
        />
        <Route
          path="templates/:id"
          element={
            <RequirePermission permission="contractTemplate.manage">
              <TemplateEditorPage />
            </RequirePermission>
          }
        />
        <Route
          path=":id"
          element={
            <RequirePermission permission="contract.view">
              <ContractDetailPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
