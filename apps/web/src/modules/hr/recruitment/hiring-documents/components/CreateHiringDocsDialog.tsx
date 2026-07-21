// Open a hiring-documents set for an employee: pick an employee (search) → create → route to the
// new set. One set per employee (server-enforced). RTL-safe.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type EmployeeDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useOnClickOutside } from '../../../../../shared/lib/useOnClickOutside';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field } from '../../../../../shared/ui/form';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useCreateHiringDocs, useEmployeeSearch } from '../api/hiring-documents-queries';

export const CreateHiringDocsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateHiringDocs();
  const [employee, setEmployee] = useState<EmployeeDto | null>(null);
  const [term, setTerm] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setListOpen(false), listOpen);
  const { data: results = [], isFetching } = useEmployeeSearch(term);

  const reset = (): void => {
    setEmployee(null);
    setTerm('');
  };
  const close = (): void => {
    onClose();
    reset();
  };

  const submit = async (): Promise<void> => {
    if (employee === null) return;
    try {
      const set = await create.mutateAsync({ employeeId: employee.id });
      toast.success(t('hiringDocs.create.done'));
      close();
      navigate(`/hiring-documents/${set.id}`);
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('hiringDocs.create.title')}
      description={t('hiringDocs.create.body')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>
          <Button loading={create.isPending} disabled={employee === null} onClick={() => void submit()}>
            {t('hiringDocs.create.submit')}
          </Button>
        </>
      }
    >
      <Field label={t('hiringDocs.create.employee')} required>
        {employee === null ? (
          <div className="relative" ref={ref}>
            <SearchInput
              value={term}
              onChange={(v) => {
                setTerm(v);
                setListOpen(true);
              }}
              placeholder={t('hiringDocs.create.employeeSearch')}
            />
            {listOpen && term.trim().length >= 2 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                {isFetching ? (
                  <div className="flex items-center justify-center py-4">
                    <Spinner className="h-4 w-4 text-brand-600" />
                  </div>
                ) : results.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-slate-400">{t('hiringDocs.create.noEmployees')}</p>
                ) : (
                  <ul className="max-h-64 overflow-y-auto">
                    {results.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setEmployee(e);
                            setListOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          <span className="font-mono text-xs text-slate-400" dir="ltr">{e.code}</span>
                          <span className="font-mono text-xs text-slate-500" dir="ltr">{e.applicantCode}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
            <span className="font-mono text-xs text-slate-400" dir="ltr">{employee.code}</span>
            <span className="font-mono text-xs text-slate-500" dir="ltr">{employee.applicantCode}</span>
            <button type="button" onClick={() => setEmployee(null)} className="ms-2 text-xs text-brand-600 hover:underline">
              {t('offers.form.change')}
            </button>
          </span>
        )}
      </Field>
    </Dialog>
  );
};
