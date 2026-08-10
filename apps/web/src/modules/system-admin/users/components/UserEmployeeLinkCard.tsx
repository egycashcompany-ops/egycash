// Attach this login to an employee record, or release it — decision E1.
//
// The write does NOT happen here and does not happen on any platform endpoint. HR owns the employee
// ↔ login relationship (ADR-017): `user.employeeId` is the authority and carries the unique index,
// `employee.userId` is its back-reference, and a second writer that knows about only one of them is
// how the two drift apart. So this panel calls HR's `/hr/employees/:id/user-link`, which moves both
// sides in one transaction. `user.employeeId` is not in the update schema and is reachable from
// nowhere else — a test pins that.
//
// The picker SEARCHES rather than loading the register (ADR-019): there are more employees than any
// dropdown should hold, and the one being looked for is known by name or code.
import { useRef, useState } from 'react';
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { useOnClickOutside } from '../../../../shared/lib/useOnClickOutside';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  Input,
  Spinner,
  toast,
} from '../../../../shared/ui';
import {
  useEmployeeSearch,
  useLinkedEmployee,
  useLinkUserToEmployee,
  useUnlinkUserFromEmployee,
} from '../api/user-queries';

const employeeName = (employee: EmployeeDto, locale: Locale): string =>
  (locale === 'en' ? employee.personal.fullNameEn : null) ?? employee.personal.fullNameAr;

const EmployeePicker = ({
  onPick,
  disabled,
}: {
  onPick: (employee: EmployeeDto) => void;
  disabled: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(boxRef, () => setOpen(false), open);

  const { data: results = [], isFetching } = useEmployeeSearch(term, open);

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={term}
        disabled={disabled}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t('systemAdmin.users.employee.searchPlaceholder')}
        aria-label={t('systemAdmin.users.employee.searchPlaceholder')}
      />
      {open && term.trim().length > 1 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-elevated dark:border-slate-700 dark:bg-slate-900">
          {isFetching ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
              <Spinner /> {t('systemAdmin.users.employee.searching')}
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
              {t('systemAdmin.users.employee.noResults')}
            </p>
          ) : (
            <ul>
              {results.map((employee) => (
                <li key={employee.id}>
                  <button
                    type="button"
                    // An employee who already has a login cannot take a second one — the unique
                    // index refuses it, so the row is shown and disabled rather than hidden: "not
                    // in the list" and "already taken" are different answers.
                    disabled={employee.userId !== null}
                    onClick={() => {
                      onPick(employee);
                      setOpen(false);
                      setTerm('');
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"
                  >
                    <span className="truncate text-slate-700 dark:text-slate-200">
                      {employeeName(employee, locale)}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-slate-400" dir="ltr">
                      {employee.code}
                    </span>
                    {employee.userId !== null && (
                      <Badge size="sm" tone="neutral">
                        {t('systemAdmin.users.employee.alreadyLinked')}
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export const UserEmployeeLinkCard = ({
  userId,
  employeeId,
}: {
  userId: string;
  employeeId: string | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const mayLink = can('user.edit');
  const maySearch = can('employee.view');
  const { data: linked } = useLinkedEmployee(employeeId, maySearch);
  const link = useLinkUserToEmployee(userId);
  const unlink = useUnlinkUserFromEmployee(userId);
  const busy = link.isPending || unlink.isPending;

  return (
    <Card>
      <CardHeader
        title={t('systemAdmin.users.employee.title')}
        description={t('systemAdmin.users.employee.hint')}
      />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={employeeId === null ? 'neutral' : 'brand'}>
            {t(
              employeeId === null
                ? 'systemAdmin.users.kind.system'
                : 'systemAdmin.users.kind.employee',
            )}
          </Badge>
          <span className="text-sm text-slate-600 dark:text-slate-300">
            {employeeId === null
              ? t('systemAdmin.users.employee.none')
              : linked === undefined
                ? t('systemAdmin.users.employee.linked')
                : `${employeeName(linked, locale)} · ${linked.code}`}
          </span>
        </div>

        {employeeId === null ? (
          mayLink && maySearch ? (
            <div className="space-y-2">
              <EmployeePicker
                disabled={busy}
                onPick={(employee) =>
                  link.mutate(employee.id, {
                    onSuccess: () => toast.success(t('systemAdmin.users.employee.linkedToast')),
                  })
                }
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('systemAdmin.users.employee.linkHint')}
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('systemAdmin.users.employee.noAccess')}
            </p>
          )
        ) : (
          mayLink && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirmUnlink(true)}
            >
              {t('systemAdmin.users.employee.unlink')}
            </Button>
          )
        )}
      </CardBody>

      <Dialog
        open={confirmUnlink}
        onClose={() => setConfirmUnlink(false)}
        size="sm"
        title={t('systemAdmin.users.employee.unlink')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmUnlink(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() =>
                employeeId !== null &&
                unlink.mutate(employeeId, {
                  onSuccess: () => {
                    setConfirmUnlink(false);
                    toast.success(t('systemAdmin.users.employee.unlinkedToast'));
                  },
                })
              }
            >
              {t('common.confirm')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('systemAdmin.users.employee.unlinkConfirm')}
        </p>
      </Dialog>
    </Card>
  );
};
