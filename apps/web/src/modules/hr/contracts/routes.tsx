// Contracts app route subtree (lazy-loaded). The register and detail live under
// contract.view; creation under contract.create; template administration (including
// the types catalog panel) under contractTemplate.manage — all server-enforced too.
import { Route, Routes, useSearchParams } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { ContractsListPage } from './pages/ContractsListPage';
import { ContractCreatePage } from './pages/ContractCreatePage';
import { ContractDetailPage } from './pages/ContractDetailPage';
import { TemplatesListPage } from './pages/TemplatesListPage';
import { TemplateEditorPage } from './pages/TemplateEditorPage';
import { CandidateContractPage } from './pages/CandidateContractPage';

/**
 * «عقد جديد». For an employee, the contract wizard (contract.create). For a CANDIDATE — reached
 * from «جاهزون للتعيين» with `?offerId=` — the candidate's papers and the hire (A28): printing is
 * contract.print, the hire on it employee.create.
 */
const NewContractRoute = (): JSX.Element => {
  const [sp] = useSearchParams();
  const offerId = sp.get('offerId') ?? '';
  if (offerId !== '') {
    return (
      <RequirePermission permission="contract.print">
        <CandidateContractPage offerId={offerId} />
      </RequirePermission>
    );
  }
  return (
    <RequirePermission permission="contract.create">
      <ContractCreatePage />
    </RequirePermission>
  );
};

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
          element={<NewContractRoute />}
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
