// Asking for somebody to be taught something.
//
// ONE PERSON, ONE SESSION, ONE REASON. The reason is required because a nomination is a request
// somebody else has to answer, and «no reason given» is not a request anybody can act on — the
// same argument that makes a refusal's note mandatory on the other side of this screen.
//
// A SEARCH BOX RATHER THAN A LIST, for the reason `EmployeePicker` records: the list is the
// company, and a multi-select loaded from one page answers «which of the ones that happened to be
// fetched» while quietly hiding the rest.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type EmployeeDto, type Locale, type Paginated } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { buildQuery, getPage } from '../../../../shared/lib/api-client';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import { formatDate } from '../../../../shared/lib/format';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useCreateTrainingNomination, useTrainingSessions } from '../api/training-queries';

/** Enough characters to mean something. One letter matches most of the company. */
const MIN_QUERY = 2;

export const NominateDialog = ({ onClose }: { onClose: () => void }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const create = useCreateTrainingNomination();
  const [term, setTerm] = useState('');
  const [employee, setEmployee] = useState<{ id: string; code: string; name: string } | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [reason, setReason] = useState('');

  const search = useQuery({
    queryKey: ['employees', 'picker', term.trim()],
    enabled: term.trim().length >= MIN_QUERY,
    queryFn: () =>
      getPage<EmployeeDto>(
        `/hr/employees${buildQuery({ search: term.trim(), page: 1, pageSize: 10 })}`,
      ),
    staleTime: 30_000,
  });

  // Only sessions somebody can still be put into. A finished session in this list would be a
  // choice the save refuses — a trap with a label on it.
  const sessions = useTrainingSessions({ page: 1, pageSize: 100, status: 'scheduled' });
  const options = (sessions.data as Paginated<{ id: string; code: string; courseName: { ar: string; en: string }; startsAt: string }> | undefined)?.items ?? [];

  const complete = employee !== null && sessionId !== '' && reason.trim() !== '';

  const submit = async (): Promise<void> => {
    if (employee === null) return;
    try {
      await create.mutateAsync({
        employeeId: employee.id,
        sessionId,
        reason: reason.trim(),
        submit: true,
      });
      toast.success(t('training.nomination.done.submitted'));
      onClose();
    } catch {
      // surfaced globally — including «already nominated» and «already holds a seat»
    }
  };

  const results = ((search.data as Paginated<EmployeeDto> | undefined)?.items ?? []).slice(0, 8);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('training.nomination.new')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} disabled={!complete} onClick={() => void submit()}>
            {t('training.nomination.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('training.nomination.employee')} required>
          {employee === null ? (
            <div className="space-y-2">
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={t('training.nomination.employeeSearch')}
              />
              {results.length > 0 && (
                <ul className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  {results.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                        onClick={() => {
                          setEmployee({
                            id: row.id,
                            code: row.code,
                            name: row.personal.fullNameAr,
                          });
                          setTerm('');
                        }}
                      >
                        <span>{row.personal.fullNameAr}</span>
                        <span className="font-mono text-xs text-slate-500" dir="ltr">
                          {row.code}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <span className="text-slate-700 dark:text-slate-200">{employee.name}</span>
              <button
                type="button"
                onClick={() => setEmployee(null)}
                className="ms-2 text-xs text-brand-600 hover:underline"
              >
                {t('offers.form.change')}
              </button>
            </span>
          )}
        </Field>

        <Field label={t('training.session.title')} required>
          <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">{t('common.select')}</option>
            {options.map((session) => (
              <option key={session.id} value={session.id}>
                {`${session.courseName[locale]} · ${formatDate(session.startsAt, locale)}`}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('training.nomination.reason')} required hint={t('training.nomination.reasonHint')}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
