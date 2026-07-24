// Assemble the Electronic Employee File for an employee (whose hiring documents are complete —
// server-enforced): pick an employee (search) → create → route to the new file. One file per
// employee. RTL-safe.
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
import { useCreateEmployeeFile, useEmployeeSearch } from '../api/employee-file-queries';

export const CreateEmployeeFileDialog = ({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateEmployeeFile();
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
      const file = await create.mutateAsync({ employeeId: employee.id });
      toast.success(t('employeeFiles.create.done'));
      close();
      navigate(`/employee-files/${file.id}`);
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('employeeFiles.create.title')}
      description={t('employeeFiles.create.body')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>
          <Button loading={create.isPending} disabled={employee === null} onClick={() => void submit()}>
            {t('employeeFiles.create.submit')}
          </Button>
        </>
      }
    >
      <Field label={t('employeeFiles.create.employee')} required hint={t('employeeFiles.create.employeeHint')}>
        {employee === null ? (
          <div className="relative" ref={ref}>
            <SearchInput
              value={term}
              onChange={(v) => {
                setTerm(v);
                setListOpen(true);
              }}
              placeholder={t('employeeFiles.create.employeeSearch')}
            />
            {listOpen && term.trim().length >= 2 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                {isFetching ? (
                  <div className="flex items-center justify-center py-4">
                    <Spinner className="h-4 w-4 text-brand-600" />
                  </div>
                ) : results.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-slate-400">{t('employeeFiles.create.noEmployees')}</p>
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
