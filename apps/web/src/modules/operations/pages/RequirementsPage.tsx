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
// reading another module's org structure. This roster replaces that: membership is explicit.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Button } from '../../../shared/ui/Button';
import { Card, CardBody } from '../../../shared/ui/Card';
import { Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import {
  useOperationsCrewDirectory,
  useRemoveCrewRequirements,
  useSetCrewRequirements,
} from '../api/operations-queries';
import { AddCrewMemberDialog } from '../components/AddCrewMemberDialog';
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
  const removeMember = useRemoveCrewRequirements();

  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

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

  const remove = async (member: OperationsCrewMemberDto): Promise<void> => {
    if (!window.confirm(t('operations.crew.requirements.confirmRemove'))) return;
    try {
      await removeMember.mutateAsync(member.employeeId);
      toast.success(t('operations.crew.requirements.removed'));
    } catch {
      toast.error(t('operations.crew.requirements.removeFailed'));
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
    {
      key: 'actions',
      header: '',
      render: (row) =>
        canPlan ? (
          <button
            type="button"
            aria-label={t('common.remove')}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={() => void remove(row)}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        ) : null,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.crew.requirements.title')}
        description={t('operations.crew.requirements.subtitle')}
        actions={
          canPlan ? (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon className="h-4 w-4" />
              {t('operations.crew.requirements.add')}
            </Button>
          ) : undefined
        }
      />

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

      <AddCrewMemberDialog open={adding} onClose={() => setAdding(false)} />
    </PageContainer>
  );
};
