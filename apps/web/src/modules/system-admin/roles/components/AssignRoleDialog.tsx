// Grant a role to one account.
//
// Three things the form states rather than hides, because each is a rule the server enforces and an
// administrator would otherwise discover as a 422:
//
//   • **A hierarchical scope resolves to the account's OWN placement.** There is no unit picker
//     here: a branch-scoped grant means "this account's branch", and the server re-derives it from
//     the account rather than trusting an id in the request. So the form SHOWS the placement the
//     scope will resolve to, and refuses to submit when there is none.
//   • **`section` and `department` are honoured by four collections.** Everywhere else the grant
//     behaves as branch scope — see AssignmentScopeBadge. Choosing one of them says so.
//   • **A grant can never be wider than the granter's own.** The server refuses it (S-guards), and
//     saying it here first is cheaper than a round trip.
//   • **A branch or department grant may REACH further than the account's own unit.** A department
//     is one record per branch but one department to the company, so «مدير الحركة» in one site can
//     be given a second site to follow, and «مدير عام الحركة» is that department in every site. The
//     reach is chosen here — branches by name, the department by its company-wide name — and the
//     server checks it against the granter's own reach.
import { useMemo, useState } from 'react';
import { DATA_SCOPES, type CreateRoleAssignment, type DataScope, type UserDto } from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Button, Dialog, Field, Form, Input, Select, toast } from '../../../../shared/ui';
import { useBranchOptions } from '../../../organization/shared/references';
import { RolePicker } from './RolePicker';
import { useCreateAssignment, useDepartmentCatalog } from '../api/role-queries';

/** How far a branch or department grant reaches. `home` is exactly the grant that existed before. */
type Reach = 'home' | 'some' | 'all';

/** The placement each hierarchical scope resolves against. `own` and `organization` need none. */
const REQUIRED_PLACEMENT: Partial<Record<DataScope, 'branchId' | 'departmentId' | 'sectionId'>> = {
  branch: 'branchId',
  department: 'departmentId',
  section: 'sectionId',
};

export const AssignRoleDialog = ({
  user,
  heldRoleIds,
  onClose,
}: {
  user: UserDto;
  heldRoleIds: readonly string[];
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState<DataScope>('own');
  const [reach, setReach] = useState<Reach>('home');
  const [catalogId, setCatalogId] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const assign = useCreateAssignment();

  const reachable = scope === 'branch' || scope === 'department';
  const { data: branches = [] } = useBranchOptions(reachable);
  const { data: catalog = [] } = useDepartmentCatalog(scope === 'department');

  const homeBranch = user.organization.branchId;
  // The account's own branch is never a choice: it is in the grant whether or not it is ticked.
  const addable = useMemo(() => branches.filter((b) => b.id !== homeBranch), [branches, homeBranch]);
  const toggleBranch = (id: string): void =>
    setAdded((cur) => (cur.includes(id) ? cur.filter((b) => b !== id) : [...cur, id]));

  // With a reach beyond the home unit the home placement is optional (a company-wide manager may
  // sit in no branch at all); without one the old rule holds and the form says so.
  const needed = REQUIRED_PLACEMENT[scope];
  const namesDepartment = scope === 'department' && catalogId !== '';
  const missingPlacement =
    needed !== undefined && user.organization[needed] === null && reach === 'home' && !namesDepartment;
  const emptyReach = reach === 'some' && added.length === 0 && homeBranch === null;
  const badWindow = validFrom !== '' && validTo !== '' && validFrom >= validTo;
  const blocked = roleId === '' || missingPlacement || emptyReach || badWindow;

  const submit = (): void => {
    if (blocked) return;
    const body: CreateRoleAssignment = {
      userId: user.id,
      roleId,
      scope,
      ...(reachable && reach === 'some' && added.length > 0 ? { branchIds: added } : {}),
      ...(reachable && reach === 'all' ? { allBranches: true } : {}),
      ...(namesDepartment ? { departmentCatalogId: catalogId } : {}),
      ...(validFrom === '' ? {} : { validFrom: new Date(validFrom) }),
      ...(validTo === '' ? {} : { validTo: new Date(validTo) }),
    };
    assign.mutate(body, {
      onSuccess: () => {
        toast.success(t('systemAdmin.assignments.granted'));
        onClose();
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={t('systemAdmin.assignments.grantTitle')}
      description={t('systemAdmin.assignments.grantHint')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" loading={assign.isPending} disabled={blocked} onClick={submit}>
            {t('systemAdmin.assignments.grant')}
          </Button>
        </div>
      }
    >
      <Form onSubmit={submit}>
        <Field label={t('systemAdmin.assignments.role')} required>
          <RolePicker
            value={roleId}
            onChange={setRoleId}
            alreadyHeld={heldRoleIds}
            ariaLabel={t('systemAdmin.roles.picker.placeholder')}
          />
        </Field>

        <Field
          label={t('systemAdmin.assignments.scope')}
          hint={t('systemAdmin.assignments.scopeHint')}
          error={missingPlacement ? t('systemAdmin.assignments.noPlacement') : undefined}
        >
          <Select value={scope} onChange={(e) => setScope(e.target.value as DataScope)}>
            {DATA_SCOPES.map((value) => (
              <option key={value} value={value}>
                {t(`systemAdmin.assignments.scopes.${value}`)}
              </option>
            ))}
          </Select>
        </Field>

        {(scope === 'section' || scope === 'department') && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t('systemAdmin.assignments.scopeWidens')}
          </p>
        )}

        {scope === 'department' && (
          <Field
            label={t('systemAdmin.assignments.department')}
            hint={t('systemAdmin.assignments.departmentHint')}
          >
            <Select value={catalogId} onChange={(e) => setCatalogId(e.target.value)}>
              <option value="">{t('systemAdmin.assignments.departmentHome')}</option>
              {catalog.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name[locale]}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {reachable && (
          <Field label={t('systemAdmin.assignments.reach')} hint={t('systemAdmin.assignments.reachHint')}>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {(['home', 'some', 'all'] as const)
                // «all branches» is the general-manager form and only means something for a department.
                .filter((r) => r !== 'all' || scope === 'department')
                .map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={reach === r}
                    onClick={() => setReach(r)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      reach === r
                        ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-300'
                        : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {t(`systemAdmin.assignments.reaches.${r}`)}
                  </button>
                ))}
            </div>
          </Field>
        )}

        {reachable && reach === 'some' && (
          <Field
            label={t('systemAdmin.assignments.branches')}
            hint={t('systemAdmin.assignments.branchesHint')}
            error={emptyReach ? t('systemAdmin.assignments.noBranches') : undefined}
          >
            <div className="flex flex-wrap gap-2">
              {homeBranch !== null && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {branches.find((b) => b.id === homeBranch)?.name[locale] ?? homeBranch} · {t('systemAdmin.assignments.homeBranch')}
                </span>
              )}
              {addable.map((b) => {
                const on = added.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleBranch(b.id)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      on
                        ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-300'
                        : 'border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {on ? '✓ ' : '+ '}
                    {b.name[locale]}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('systemAdmin.assignments.validFrom')}>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field
            label={t('systemAdmin.assignments.validTo')}
            hint={t('systemAdmin.assignments.validToHint')}
            error={badWindow ? t('systemAdmin.assignments.badWindow') : undefined}
          >
            <Input
              type="date"
              value={validTo}
              error={badWindow}
              onChange={(e) => setValidTo(e.target.value)}
            />
          </Field>
        </div>
      </Form>
    </Dialog>
  );
};
