// Approval chains — «مين اللي لازم يوافق، وبالترتيب ده».
//
// The screen is organized the way the rule resolves, not the way the rows are stored: for each kind
// of request, the COMPANY DEFAULT first, then the places that differ from it. That ordering is the
// whole explanation of how a chain is chosen — the most specific row wins — and a flat table sorted
// by date would leave an administrator unable to tell which of five rows actually answers a request
// from «الحركة · المهندسين».
//
// A step is a permission and a LEVEL, never a title. That is the part worth stating on the screen
// itself, because it is the part that makes the whole thing work: «مدير حركة الفرع», «مدير عام
// الحركة» and «الموارد البشرية» are the same key (`leave.approve`) held at three different
// distances, so the chain follows the org chart without ever naming anybody in it. A promotion
// changes who answers; nothing here is edited.
import { useMemo, useState } from 'react';
import {
  APPROVAL_LEVELS,
  type ApprovalLevel,
  type ApprovalStep,
  type ApprovalWorkflowDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../../shared/ui';
import { Field, Select } from '../../../../shared/ui/form';
import { useBranchOptions } from '../../../organization/shared/references';
import { useDepartmentCatalog } from '../../roles/api/role-queries';
import {
  useApprovalRequestTypes,
  useApprovalWorkflows,
  useDeleteApprovalWorkflow,
  useSetApprovalWorkflow,
} from '../api/approval-queries';

interface Draft {
  requestType: string;
  departmentCatalogId: string | null;
  branchId: string | null;
  steps: ApprovalStep[];
  isActive: boolean;
}

const emptyDraft = (requestType: string): Draft => ({
  requestType,
  departmentCatalogId: null,
  branchId: null,
  steps: [],
  isActive: true,
});

export const ApprovalWorkflowsPage = (): JSX.Element => {
  const t = useT();
  const workflows = useApprovalWorkflows();
  const types = useApprovalRequestTypes();
  const branches = useBranchOptions();
  const departments = useDepartmentCatalog();
  const save = useSetApprovalWorkflow();
  const remove = useDeleteApprovalWorkflow();
  const [draft, setDraft] = useState<Draft | null>(null);

  /**
   * Grouped by request type, company default first.
   *
   * Sorted here rather than on the server because it is a presentation of the RESOLUTION rule, and
   * the server's own order (`requestType, department, branch`) is about the index.
   */
  const grouped = useMemo(() => {
    const rows = workflows.data ?? [];
    const byType = new Map<string, ApprovalWorkflowDto[]>();
    for (const row of rows) {
      byType.set(row.requestType, [...(byType.get(row.requestType) ?? []), row]);
    }
    const weight = (row: ApprovalWorkflowDto): number =>
      (row.department === null ? 0 : 2) + (row.branch === null ? 0 : 1);
    return [...byType.entries()].map(([requestType, list]) => ({
      requestType,
      rows: [...list].sort((a, b) => weight(a) - weight(b)),
    }));
  }, [workflows.data]);

  const typeName = (key: string): string =>
    types.data?.find((type) => type.key === key)?.name.ar ?? key;

  const keysFor = (requestType: string): string[] =>
    types.data?.find((type) => type.key === requestType)?.permissionKeys ?? [];

  const placeOf = (row: ApprovalWorkflowDto): string => {
    if (row.department === null && row.branch === null) return t('approvals.place.default');
    const parts = [row.department?.name.ar, row.branch?.name.ar].filter(
      (part): part is string => part !== undefined,
    );
    return parts.join(' · ');
  };

  const submit = (): void => {
    if (draft === null || draft.steps.length === 0) return;
    save.mutate(
      {
        requestType: draft.requestType,
        departmentCatalogId: draft.departmentCatalogId,
        branchId: draft.branchId,
        steps: draft.steps,
        isActive: draft.isActive,
      },
      { onSuccess: () => setDraft(null) },
    );
  };

  if (workflows.isLoading || types.isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (workflows.isError) {
    return (
      <PageContainer>
        <ErrorState onRetry={() => void workflows.refetch()} />
      </PageContainer>
    );
  }

  const firstType = types.data?.[0]?.key ?? '';

  return (
    <PageContainer>
      <PageHeader
        title={t('approvals.page.title')}
        actions={
          firstType === '' ? undefined : (
            <Button onClick={() => setDraft(emptyDraft(firstType))}>
              {t('approvals.page.add')}
            </Button>
          )
        }
      />

      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        {t('approvals.page.description')}
      </p>

      {grouped.length === 0 && <EmptyState title={t('approvals.page.empty')} />}

      <div className="space-y-4">
        {grouped.map((group) => (
          <Card key={group.requestType}>
            <CardBody>
              <h3 className="mb-3 text-sm font-semibold">{typeName(group.requestType)}</h3>
              <ul className="space-y-3">
                {group.rows.map((row) => (
                  <li
                    key={row.id}
                    className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{placeOf(row)}</span>
                        {row.department === null && row.branch === null && (
                          <Badge size="sm" tone="neutral">
                            {t('approvals.place.defaultHint')}
                          </Badge>
                        )}
                        {!row.isActive && (
                          <Badge size="sm" tone="warning">
                            {t('approvals.inactive')}
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDraft({
                              requestType: row.requestType,
                              departmentCatalogId: row.department?.id ?? null,
                              branchId: row.branch?.id ?? null,
                              steps: row.steps,
                              isActive: row.isActive,
                            })
                          }
                        >
                          {t('common.edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => remove.mutate(row.id)}
                          disabled={remove.isPending}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </div>
                    <ol className="mt-2 flex flex-wrap items-center gap-2">
                      {row.steps.map((step, index) => (
                        <li key={index} className="flex items-center gap-2">
                          {index > 0 && <span className="text-slate-400">←</span>}
                          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                            {t(`approvals.level.${step.level}`)}
                            <span className="ms-1 font-mono text-[10px] text-slate-400" dir="ltr">
                              {step.permissionKey}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={t('approvals.editor.title')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={submit}
              disabled={save.isPending || draft === null || draft.steps.length === 0}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        {draft !== null && (
          <div className="space-y-4">
            <Field label={t('approvals.editor.requestType')}>
              <Select
                value={draft.requestType}
                onChange={(e) =>
                  setDraft({ ...draft, requestType: e.target.value, steps: [] })
                }
              >
                {(types.data ?? []).map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.name.ar}
                  </option>
                ))}
              </Select>
            </Field>

            {/* Both empty means the COMPANY DEFAULT, and the hint says so — an administrator who
                has to discover that by saving and watching where the row lands is one who will
                eventually discover it on a request that routed somewhere unexpected. */}
            <Field label={t('approvals.editor.department')} hint={t('approvals.editor.placeHint')}>
              <Select
                value={draft.departmentCatalogId ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    departmentCatalogId: e.target.value === '' ? null : e.target.value,
                  })
                }
              >
                <option value="">{t('approvals.editor.anyDepartment')}</option>
                {(departments.data ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name.ar}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('approvals.editor.branch')}>
              <Select
                value={draft.branchId ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, branchId: e.target.value === '' ? null : e.target.value })
                }
              >
                <option value="">{t('approvals.editor.anyBranch')}</option>
                {(branches.data ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name.ar}
                  </option>
                ))}
              </Select>
            </Field>

            <div>
              <p className="mb-2 text-sm font-medium">{t('approvals.editor.steps')}</p>
              <p className="mb-2 text-xs text-slate-500">{t('approvals.editor.stepsHint')}</p>
              <ol className="space-y-2">
                {draft.steps.map((step, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2">
                    <span className="w-6 text-xs text-slate-400">{index + 1}.</span>
                    <Select
                      value={step.permissionKey}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          steps: draft.steps.map((s, i) =>
                            i === index ? { ...s, permissionKey: e.target.value } : s,
                          ),
                        })
                      }
                      className="min-w-40 flex-1"
                    >
                      {keysFor(draft.requestType).map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={step.level}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          steps: draft.steps.map((s, i) =>
                            i === index ? { ...s, level: e.target.value as ApprovalLevel } : s,
                          ),
                        })
                      }
                      className="min-w-40 flex-1"
                    >
                      {APPROVAL_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {t(`approvals.level.${level}`)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          steps: draft.steps.filter((_, i) => i !== index),
                        })
                      }
                    >
                      {t('common.remove')}
                    </Button>
                  </li>
                ))}
              </ol>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => {
                  const key = keysFor(draft.requestType)[0];
                  if (key === undefined) return;
                  setDraft({
                    ...draft,
                    steps: [...draft.steps, { permissionKey: key, level: 'unit', label: null }],
                  });
                }}
              >
                {t('approvals.editor.addStep')}
              </Button>
            </div>

            {save.isError && (
              <p className="text-sm text-red-600">{(save.error as Error).message}</p>
            )}
          </div>
        )}
      </Dialog>
    </PageContainer>
  );
};
