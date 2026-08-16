// Where this employee's cost is reported, over time (P-HR-23, D-CC-10).
//
// It sits on the Employment tab because that is where organizational placement already lives — a
// cost centre is a fact about where somebody belongs, not about what they are paid, and putting it
// beside the salary would suggest otherwise.
//
// The card shows HISTORY, not just the current centre. A payslip carries the centre in force on
// the last day of its period (D-CC-7), so "which centre was July's?" is a question this list has
// to be able to answer months later.
import { useState } from 'react';
import { type CostCenterAssignmentDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Badge } from '../../../../../shared/ui/Badge';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { localized } from '../../../../../shared/lib/format';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import {
  useAssignCostCenter,
  useAssignableCostCenters,
  useEmployeeCostCenters,
} from '../api/cost-center-queries';

export const EmployeeCostCenterCard = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: rows } = useEmployeeCostCenters(employeeId);
  const { data: catalog } = useAssignableCostCenters();
  const assign = useAssignCostCenter(employeeId);

  const [costCenterId, setCostCenterId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');

  const history = rows ?? [];
  const dash = '—';

  const label = (row: CostCenterAssignmentDto): string =>
    row.costCenter === null ? row.costCenterId : localized(row.costCenter.name, locale);

  const submit = async (): Promise<void> => {
    if (costCenterId === '' || effectiveFrom === '') return;
    try {
      await assign.mutateAsync({ costCenterId, effectiveFrom });
      setCostCenterId('');
      setEffectiveFrom('');
      toast.success(t('organization.costCenter.created'));
    } catch {
      // Refusals — an overlapping interval, an inactive centre — surface globally with the
      // server's own words, which say more than anything this screen could restate.
    }
  };

  return (
    <Card>
      <CardHeader
        title={t('organization.costCenter.assignments')}
        description={t('organization.costCenter.assignmentsHint')}
      />
      <CardBody className="space-y-4">
        {history.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('organization.costCenter.none')}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {history.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{label(row)}</span>
                <span className="text-slate-500 dark:text-slate-400" dir="ltr">
                  {row.effectiveFrom} → {row.effectiveTo ?? dash}
                </span>
                {row.effectiveTo === null ? (
                  <Badge tone="success">{t('organization.costCenter.current')}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <Can permission="costCenter.assign">
          <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3 dark:border-slate-800">
            <Field label={t('organization.costCenter.assignments')}>
              <Select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
                <option value="">{dash}</option>
                {(catalog?.items ?? []).map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {localized(cc.name, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('organization.costCenter.from')}>
              <Input
                type="date"
                dir="ltr"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </Field>
            <div className="flex items-end">
              <Button
                size="sm"
                loading={assign.isPending}
                disabled={costCenterId === '' || effectiveFrom === ''}
                onClick={() => void submit()}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </Can>
      </CardBody>
    </Card>
  );
};
