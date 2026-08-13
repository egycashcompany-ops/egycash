// The employee profile's Loans tab (P-HR-05, phase A) — default export, lazy-loaded by the profile
// hub exactly as the Pay Items and Adjustments tabs are, so the employees chunk stays free of this
// feature for everyone who never opens it.
//
// WHAT THIS SCREEN IS SHOWING, AND WHY IT LOOKS DIFFERENT FROM THE ADJUSTMENTS TAB BESIDE IT. An
// adjustment is one amount for one month; a loan is an amount plus the months it will come back
// over. So this screen has two levels — the obligation, and its schedule underneath — and the
// second one is the whole point: an employee who owes money is entitled to see exactly when.
//
// THE TWO-PERSON RULE IS VISIBLE HERE (D2), and so is the split beyond it: recording a request is
// `create`, while deciding it, paying it out, rescheduling it and closing it are all `approve` —
// each of those moves real money. The buttons follow the server's split so the screen cannot
// suggest an action the server will refuse.
import { useState } from 'react';
import {
  type CreateEmployeeLoan,
  type EmployeeDto,
  type EmployeeLoanDetailDto,
  type Locale,
  EMPLOYEE_LOAN_TYPES,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Badge, Button, DataTable, EmptyState, type Column } from '../../../../shared/ui';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Textarea, Select } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatMoney } from '../../../../shared/lib/format';
import {
  useAccelerateLoan,
  useCancelLoan,
  useCreateLoan,
  useDecideLoan,
  useDisburseLoan,
  useEmployeeLoans,
  useRescheduleLoan,
  useSettleLoanExternally,
  useSubmitLoan,
} from '../api/employee-loans-queries';

const PAGE_SIZE = 20;

const STATUS_TONE = {
  draft: 'neutral',
  pendingApproval: 'warning',
  approved: 'info',
  active: 'success',
  settled: 'neutral',
  cancelled: 'neutral',
  // Not a failure and not an error — a fact somebody has to act on outside this system (D8).
  outstandingAtExit: 'danger',
} as const;

/** `deducted` is the only one of the three that is a fact rather than an intention. */
const INSTALLMENT_TONE = {
  planned: 'info',
  deducted: 'success',
  cancelled: 'neutral',
} as const;

const EmployeeLoansTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [adding, setAdding] = useState(false);
  const [rescheduling, setRescheduling] = useState<EmployeeLoanDetailDto | null>(null);
  const [accelerating, setAccelerating] = useState<EmployeeLoanDetailDto | null>(null);
  const [disbursing, setDisbursing] = useState<EmployeeLoanDetailDto | null>(null);
  const [settling, setSettling] = useState<EmployeeLoanDetailDto | null>(null);

  const rows = useEmployeeLoans(employee.id, {
    page: 1,
    pageSize: PAGE_SIZE,
    sortBy: 'createdAt',
    sortDir: 'desc',
  });
  const submit = useSubmitLoan(employee.id);
  const decide = useDecideLoan(employee.id);
  const cancel = useCancelLoan(employee.id);

  const canRecord = can('employeeLoan.create');
  const canApprove = can('employeeLoan.approve');

  const onSubmit = (loan: EmployeeLoanDetailDto): void => {
    submit.mutate(
      { id: loan.id, version: loan.version },
      { onSuccess: () => toast.success(t('loans.submitted')) },
    );
  };
  const onDecide = (loan: EmployeeLoanDetailDto, decision: 'approved' | 'rejected'): void => {
    decide.mutate(
      { id: loan.id, body: { decision, version: loan.version } },
      { onSuccess: () => toast.success(t(`loans.${decision}`)) },
    );
  };
  const onCancel = (loan: EmployeeLoanDetailDto): void => {
    const reason = window.prompt(t('loans.cancelReason'));
    if (reason === null || reason.trim() === '') return;
    cancel.mutate(
      { id: loan.id, body: { reason: reason.trim(), version: loan.version } },
      { onSuccess: () => toast.success(t('loans.cancelled')) },
    );
  };

  const items = rows.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{t('loans.hint')}</p>
        {canRecord && (
          <Button size="sm" onClick={() => setAdding(true)}>
            {t('loans.add')}
          </Button>
        )}
      </div>

      {items.length === 0 && !rows.isLoading ? (
        <EmptyState title={t('loans.empty')} />
      ) : (
        items.map((loan) => (
          <LoanCard
            key={loan.id}
            loan={loan}
            canRecord={canRecord}
            canApprove={canApprove}
            onSubmit={() => onSubmit(loan)}
            onDecide={(decision) => onDecide(loan, decision)}
            onCancel={() => onCancel(loan)}
            onDisburse={() => setDisbursing(loan)}
            onReschedule={() => setRescheduling(loan)}
            onAccelerate={() => setAccelerating(loan)}
            onSettle={() => setSettling(loan)}
          />
        ))
      )}

      {adding && <AddLoanDialog employee={employee} onClose={() => setAdding(false)} />}
      {disbursing !== null && (
        <DisburseDialog
          employee={employee}
          loan={disbursing}
          onClose={() => setDisbursing(null)}
        />
      )}
      {rescheduling !== null && (
        <RescheduleDialog
          employee={employee}
          loan={rescheduling}
          onClose={() => setRescheduling(null)}
        />
      )}
      {accelerating !== null && (
        <AccelerateDialog
          employee={employee}
          loan={accelerating}
          onClose={() => setAccelerating(null)}
        />
      )}
      {settling !== null && (
        <SettleDialog employee={employee} loan={settling} onClose={() => setSettling(null)} />
      )}
    </div>
  );
};

/** One obligation, with its schedule underneath — the two levels this feature actually has. */
const LoanCard = ({
  loan,
  canRecord,
  canApprove,
  onSubmit,
  onDecide,
  onCancel,
  onDisburse,
  onReschedule,
  onAccelerate,
  onSettle,
}: {
  loan: EmployeeLoanDetailDto;
  canRecord: boolean;
  canApprove: boolean;
  onSubmit: () => void;
  onDecide: (decision: 'approved' | 'rejected') => void;
  onCancel: () => void;
  onDisburse: () => void;
  onReschedule: () => void;
  onAccelerate: () => void;
  onSettle: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const cancellable =
    loan.status === 'draft' || loan.status === 'pendingApproval' || loan.status === 'approved';

  const columns: Column<EmployeeLoanDetailDto['installments'][number]>[] = [
    { key: 'seq', header: '#', render: (r) => String(r.seq) },
    { key: 'period', header: t('loans.period'), render: (r) => r.period },
    {
      key: 'amount',
      header: t('loans.installmentAmount'),
      render: (r) => formatMoney(r.amount, loan.currency, locale),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (r) => (
        <Badge tone={INSTALLMENT_TONE[r.status]}>{t(`loans.installment.${r.status}`)}</Badge>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title={`${t(`loans.type.${loan.type}`)} — ${formatMoney(loan.principal, loan.currency, locale)}`}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={STATUS_TONE[loan.status]}>{t(`loans.status.${loan.status}`)}</Badge>
            {loan.status === 'draft' && canRecord && (
              <Button size="sm" variant="ghost" onClick={onSubmit}>
                {t('loans.submit')}
              </Button>
            )}
            {loan.status === 'pendingApproval' && canApprove && (
              <>
                <Button size="sm" variant="ghost" onClick={() => onDecide('approved')}>
                  {t('loans.approve')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDecide('rejected')}>
                  {t('loans.reject')}
                </Button>
              </>
            )}
            {loan.status === 'approved' && canApprove && (
              <Button size="sm" variant="ghost" onClick={onDisburse}>
                {t('loans.disburse')}
              </Button>
            )}
            {loan.status === 'active' && canApprove && (
              <>
                <Button size="sm" variant="ghost" onClick={onReschedule}>
                  {t('loans.reschedule')}
                </Button>
                {/* D7-2 — pay more through payroll; D7-1 — money that arrived some other way. */}
                <Button size="sm" variant="ghost" onClick={onAccelerate}>
                  {t('loans.accelerate')}
                </Button>
                <Button size="sm" variant="ghost" onClick={onSettle}>
                  {t('loans.settleExternal')}
                </Button>
              </>
            )}
            {cancellable && canRecord && (
              <Button size="sm" variant="danger" onClick={onCancel}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
        }
      />
      <CardBody>
        <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">{t('loans.remaining')}</dt>
            <dd>{formatMoney(loan.remaining, loan.currency, locale)}</dd>
          </div>
          {/* What payroll has actually taken — the ledger's sum, not a stored figure. */}
          <div>
            <dt className="text-slate-500">{t('loans.repaid')}</dt>
            <dd>{formatMoney(loan.repaid, loan.currency, locale)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('loans.installmentCount')}</dt>
            <dd>{String(loan.installmentCount)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('loans.firstPeriod')}</dt>
            <dd>{loan.firstPeriod}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('loans.disbursedAt')}</dt>
            <dd>{loan.disbursedAt ?? '—'}</dd>
          </div>
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-slate-500">{t('loans.reason')}</dt>
            <dd>{loan.reason}</dd>
          </div>
        </dl>

        {/* No schedule until the money has actually been handed over — that is what D5 means. */}
        {loan.installments.length === 0 ? (
          <p className="text-sm text-slate-500">{t('loans.noSchedule')}</p>
        ) : (
          <DataTable
            columns={columns}
            rows={loan.installments}
            rowKey={(r) => r.id}
          />
        )}
      </CardBody>
    </Card>
  );
};

const AddLoanDialog = ({
  employee,
  onClose,
}: {
  employee: EmployeeDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateLoan(employee.id);
  const [type, setType] = useState<CreateEmployeeLoan['type']>('loan');
  const [principal, setPrincipal] = useState('');
  const [installmentCount, setInstallmentCount] = useState('1');
  const [firstPeriod, setFirstPeriod] = useState('');
  const [reason, setReason] = useState('');

  const save = (): void => {
    create.mutate(
      {
        type,
        principal: Number(principal),
        currency: employee.employment.salary?.currency ?? 'EGP',
        installmentCount: Number(installmentCount),
        firstPeriod,
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t('loans.created'));
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('loans.add')}
      description={t('loans.addHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('loans.type')} required>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as CreateEmployeeLoan['type'])}
          >
            {EMPLOYEE_LOAN_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`loans.type.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        {/* The principal is written once and never reduced: it IS the obligation (D10). */}
        <Field label={t('loans.principal')} required>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
          />
        </Field>
        <Field label={t('loans.installmentCount')} required>
          <Input
            type="number"
            min="1"
            step="1"
            value={installmentCount}
            onChange={(e) => setInstallmentCount(e.target.value)}
          />
        </Field>
        <Field label={t('loans.firstPeriod')} required>
          <Input type="month" value={firstPeriod} onChange={(e) => setFirstPeriod(e.target.value)} />
        </Field>
        <Field label={t('loans.reason')} required>
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};

/** ECMS pays nobody — this dialog records that a payment happened somewhere else. */
const DisburseDialog = ({
  employee,
  loan,
  onClose,
}: {
  employee: EmployeeDto;
  loan: EmployeeLoanDetailDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const disburse = useDisburseLoan(employee.id);
  const [disbursedAt, setDisbursedAt] = useState('');
  const [note, setNote] = useState('');

  const save = (): void => {
    disburse.mutate(
      { id: loan.id, body: { disbursedAt, note: note.trim(), version: loan.version } },
      {
        onSuccess: () => {
          toast.success(t('loans.disbursed'));
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('loans.disburse')}
      description={t('loans.disburseHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={disburse.isPending} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('loans.disbursedAt')} required>
          <Input type="date" value={disbursedAt} onChange={(e) => setDisbursedAt(e.target.value)} />
        </Field>
        <Field label={t('common.note')}>
          <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};

/** The amount is deliberately absent: a reschedule moves instalments, never the debt (D6). */
const RescheduleDialog = ({
  employee,
  loan,
  onClose,
}: {
  employee: EmployeeDto;
  loan: EmployeeLoanDetailDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const reschedule = useRescheduleLoan(employee.id);
  const [installmentCount, setInstallmentCount] = useState('1');
  const [firstPeriod, setFirstPeriod] = useState('');
  const [reason, setReason] = useState('');

  const save = (): void => {
    reschedule.mutate(
      {
        id: loan.id,
        body: {
          installmentCount: Number(installmentCount),
          firstPeriod,
          reason: reason.trim(),
          version: loan.version,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('loans.rescheduled'));
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('loans.reschedule')}
      description={t('loans.rescheduleHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={reschedule.isPending} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('loans.installmentCount')} required>
          <Input
            type="number"
            min="1"
            step="1"
            value={installmentCount}
            onChange={(e) => setInstallmentCount(e.target.value)}
          />
        </Field>
        <Field label={t('loans.firstPeriod')} required>
          <Input type="month" value={firstPeriod} onChange={(e) => setFirstPeriod(e.target.value)} />
        </Field>
        <Field label={t('loans.reason')} required>
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};

/**
 * D7-2 — the payroll path to finishing early.
 *
 * It names a MONTH and an extra amount, and nothing else: the server takes the extra out of the
 * last instalments, so the loan ends sooner and the debt does not move. Distinct from the dialog
 * below it in the one way that matters — this money will come out of a salary.
 */
const AccelerateDialog = ({
  employee,
  loan,
  onClose,
}: {
  employee: EmployeeDto;
  loan: EmployeeLoanDetailDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const accelerate = useAccelerateLoan(employee.id);
  const [period, setPeriod] = useState('');
  const [extraAmount, setExtraAmount] = useState('');
  const [reason, setReason] = useState('');

  const save = (): void => {
    accelerate.mutate(
      {
        id: loan.id,
        body: {
          period,
          extraAmount: Number(extraAmount),
          reason: reason.trim(),
          version: loan.version,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('loans.accelerated'));
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('loans.accelerate')}
      description={t('loans.accelerateHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={accelerate.isPending} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('loans.period')} required>
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <Field label={t('loans.extraAmount')} required>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={extraAmount}
            onChange={(e) => setExtraAmount(e.target.value)}
          />
        </Field>
        <Field label={t('loans.reason')} required>
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};

/** D7-1 — money collected outside ECMS. It closes the loan and deducts nothing from any salary. */
const SettleDialog = ({
  employee,
  loan,
  onClose,
}: {
  employee: EmployeeDto;
  loan: EmployeeLoanDetailDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const settle = useSettleLoanExternally(employee.id);
  const [reason, setReason] = useState('');

  const save = (): void => {
    settle.mutate(
      { id: loan.id, body: { amount: loan.remaining, reason: reason.trim(), version: loan.version } },
      {
        onSuccess: () => {
          toast.success(t('loans.settled'));
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('loans.settleExternal')}
      description={t('loans.settleExternalHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={settle.isPending} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Shown, not typed: a settlement closes the loan, so its amount is the balance itself. */}
        <Field label={t('loans.remaining')}>
          <Input readOnly value={formatMoney(loan.remaining, loan.currency, locale)} />
        </Field>
        <Field label={t('loans.reason')} required>
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};

export default EmployeeLoansTab;
