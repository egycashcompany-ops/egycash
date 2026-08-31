// Operations crew roster and requirements (B3) — the legacy `/requirement` screen.
//
// WHAT THE LEGACY SCREEN WAS (discovery §9, contad_app.js:4324-4372): a matrix of NINE checkboxes
// written onto the employee document. Only `leader` was ever read by a server query; the rest were
// pool decoration and browser filters, and four of them were never read at all (quirk Q25).
//
// TWO THINGS THIS SCREEN IS NOT:
//   1. It is not an eligibility editor. Nothing here gates an assignment — the crew board will
//      accept an employee with every box unticked, and one with no row at all. That is the
//      approved decision, and the integration tests assert it rather than trusting this comment.
//   2. It is not an HR screen. The row belongs to Operations; the person belongs to HR. Adding
//      someone here says "this person is operations crew", it does not edit their employee record.
//
// Legacy found its crew with `department:'نقل الاموال' + sub_department:'التشغيل'` — Operations
// reading another module's org structure. ECMS replaced that with an explicit roster you added
// people to — and that turned out to be a SECOND list of who works here, which is a list that goes
// stale: a new hire stayed invisible to Operations until somebody remembered to add them.
//
// Membership is the ORG CHART again (`operations.crewDepartmentIds`), so this screen no longer
// adds or removes anybody. What it records is what Operations knows ABOUT a member — the flags —
// and the row behind them is created the first time one is set. Somebody with no row yet shows
// with nothing recorded, which is a different thing from carrying nothing.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Card, CardBody } from '../../../shared/ui/Card';
import { Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useOperationsCrewDirectory,
  useSetCrewRequirements,
} from '../api/operations-queries';
import { CrewDepartmentsCard } from '../components/CrewDepartmentsCard';
import {
  REQUIREMENT_FLAGS,
  toFlagPayload,
  type RequirementFlag,
} from '../lib/requirements';

export const RequirementsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [sp] = useSearchParams();
  const canPlan = can('operationsCrew.plan');

  // The roster is day-independent, but the directory endpoint serves it — asking for today keeps
  // one source for "who is operations crew" rather than a second listing that could disagree.
  const directory = useOperationsCrewDirectory(sp.get('date'));
  const setFlags = useSetCrewRequirements();

  const [search, setSearch] = useState('');

  const members = (directory.data?.members ?? []).filter((member) => {
    const needle = search.trim().toLowerCase();
    return (
      needle === '' ||
      member.fullNameAr.toLowerCase().includes(needle) ||
      member.code.toLowerCase().includes(needle)
    );
  });

  const toggle = async (member: OperationsCrewMemberDto, flag: RequirementFlag): Promise<void> => {
    try {
      // The endpoint is an upsert of the WHOLE row, exactly as the legacy checkbox line was saved,
      // so the current flags are sent with the one being toggled.
      await setFlags.mutateAsync({
        employeeId: member.employeeId,
        body: toFlagPayload(member.requirements, flag, member.requirements?.[flag] !== true),
      });
    } catch {
      toast.error(t('operations.crew.requirements.saveFailed'));
    }
  };


  const columns: Column<OperationsCrewMemberDto>[] = [
    {
      key: 'employee',
      header: t('operations.crew.requirements.employee'),
      render: (row) => (
        <div>
          <div className="font-medium">{row.fullNameAr}</div>
          <div className="text-xs tabular-nums text-slate-500">{row.code}</div>
        </div>
      ),
    },
    ...REQUIREMENT_FLAGS.map((flag) => ({
      key: flag,
      header: t(`operations.crew.flag.${flag}`),
      render: (row: OperationsCrewMemberDto) => (
        <input
          type="checkbox"
          className="h-4 w-4"
          aria-label={`${row.fullNameAr} — ${t(`operations.crew.flag.${flag}`)}`}
          checked={row.requirements?.[flag] === true}
          disabled={!canPlan || setFlags.isPending}
          onChange={() => void toggle(row, flag)}
        />
      ),
    })),
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.crew.requirements.title')}
        description={t('operations.crew.requirements.subtitle')}
      />

      {/* Who the crew IS, above what the crew CARRIES — the roster below is a consequence of it,
          and an operator who cannot see the cause reads an incomplete list as a complete one. */}
      <CrewDepartmentsCard />

      <Card className="mb-4">
        <CardBody>
          <label className="block max-w-sm text-sm">
            <span className="mb-1 block text-slate-500">{t('common.search')}</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {/* Said once, plainly, on the screen an operator might otherwise read as a gate. */}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {t('operations.crew.requirements.notAGate')}
          </p>
          {directory.data?.rosterIsDerived === false && (
            // Otherwise a frozen fallback list looks exactly like a correctly configured one, and
            // nobody would learn why a new hire never appears.
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {t('operations.crew.requirements.unconfigured')}
            </p>
          )}
        </CardBody>
      </Card>

      <DataTable
        columns={columns}
        rows={members}
        rowKey={(row) => row.employeeId}
        loading={directory.isLoading}
        error={directory.error}
        onRetry={() => void directory.refetch()}
        empty={t('operations.crew.requirements.empty')}
      />

    </PageContainer>
  );
};
