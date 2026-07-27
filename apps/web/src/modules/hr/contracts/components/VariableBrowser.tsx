// D5/D7 — the variable browser: the SERVER-owned catalog rendered as an insertable
// palette. Clicking an entry inserts `{{key}}` at the caret of the focused editor.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { useContractVariables } from '../api/contract-queries';

export const VariableBrowser = ({ onInsert }: { onInsert?: (key: string) => void }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data, isLoading } = useContractVariables();

  return (
    <Card>
      <CardHeader title={t('contracts.variables.title')} description={t('contracts.variables.hint')} />
      <CardBody>
        {isLoading ? (
          <LoadingState />
        ) : (
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {(data ?? []).map((v) => (
              <li key={v.key}>
                <button
                  type="button"
                  onClick={() => onInsert?.(v.key)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-start text-sm hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {v.label[locale]}
                      {v.required && <span className="text-red-500"> *</span>}
                    </span>
                    <code className="text-xs text-brand-600 dark:text-brand-300" dir="ltr">{`{{${v.key}}}`}</code>
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400">{v.sample}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
};
