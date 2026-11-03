// «شكل الصفحات»: how every ATM page reads — the text size, bold or not, and how dark the tables'
// lines are (`atm.display`). The owner (2026-11-03): «خلى حجم الكلام فى الصفحات وإذا كان Bold أو لأ +
// درجة لون خطوط الجداول .. أقدر أتحكم فيها من /atm/settings».
//
// One look for the whole company, as the page's other cards are one fact for it; the server
// answers `atmSettings.manage` at organization scope. The sample under the choices draws with the
// choice being made (`atmDisplayScopeProps(…, true)`), before anything is saved; once saved, every
// ATM page — this one included — draws with it.
import { useEffect, useState } from 'react';
import {
  ATM_DEFAULT_DISPLAY,
  ATM_TABLE_LINES,
  ATM_TEXT_SIZES,
  type AtmDisplaySetting,
  type AtmTableLines,
  type AtmTextSize,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { Checkbox, Field, Select } from '../../../../shared/ui/form';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatNumber } from '../../../../shared/lib/format';
import { useAtmDisplay, useSaveAtmDisplay } from '../../api/settings-queries';
import { atmDisplayScopeProps } from '../../lib/atm-display';

/** Pure: is the choice the one stored? */
export const sameDisplay = (a: AtmDisplaySetting, b: AtmDisplaySetting): boolean =>
  a.textSize === b.textSize && a.bold === b.bold && a.tableLines === b.tableLines;

/** The sample's rows — what a board row reads like; every name synthetic. */
const SAMPLE_ROWS = [
  ['MISR', '1150744', 'SYN فرع القصر العيني', 'SYN الدقي'],
  ['NBE', '25990323', 'SYN معهد التعاون', 'SYN زايد'],
  ['CIB', '70493', 'SYN الإسماعيلية', 'SYN أكتوبر'],
] as const;

export const DisplaySettingsCard = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const query = useAtmDisplay();
  const save = useSaveAtmDisplay();
  const stored = query.data ?? ATM_DEFAULT_DISPLAY;
  const [draft, setDraft] = useState<AtmDisplaySetting>(stored);
  // Follow the server once it answers, and after every save.
  const storedSignature = `${String(stored.textSize)}|${String(stored.bold)}|${stored.tableLines}`;
  const [followed, setFollowed] = useState<string | null>(null);
  useEffect(() => {
    if (followed === storedSignature) return;
    setFollowed(storedSignature);
    setDraft(stored);
  }, [storedSignature, followed, stored]);

  const write = (next: AtmDisplaySetting): void => {
    // A refused save is toasted by the global handler — the save declares no `onError`.
    save.mutate(next, { onSuccess: () => toast.success(t('atm.settings.display.saved')) });
  };

  const sizeLabel = (size: AtmTextSize): string =>
    size === 100
      ? t('atm.settings.display.sizeAsIs', { size: formatNumber(size, locale) })
      : t('atm.settings.display.size', { size: formatNumber(size, locale) });

  return (
    <Card>
      <CardHeader
        title={t('atm.settings.display.title')}
        description={t('atm.settings.display.hint')}
      />
      <CardBody className="space-y-4">
        {query.isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <div className="grid items-end gap-4 sm:grid-cols-3">
              <Field label={t('atm.settings.display.textSize')}>
                <Select
                  value={String(draft.textSize)}
                  disabled={save.isPending}
                  data-display-field="textSize"
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      textSize: Number(e.target.value) as AtmTextSize,
                    }))
                  }
                >
                  {ATM_TEXT_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {sizeLabel(size)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('atm.settings.display.tableLines')}>
                <Select
                  value={draft.tableLines}
                  disabled={save.isPending}
                  data-display-field="tableLines"
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, tableLines: e.target.value as AtmTableLines }))
                  }
                >
                  {ATM_TABLE_LINES.map((lines) => (
                    <option key={lines} value={lines}>
                      {t(`atm.settings.display.lines.${lines}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="pb-2" data-display-field="bold">
                <Checkbox
                  label={t('atm.settings.display.bold')}
                  checked={draft.bold}
                  disabled={save.isPending}
                  onChange={() => setDraft((prev) => ({ ...prev, bold: !prev.bold }))}
                />
              </div>
            </div>

            {/* The choice, drawn before it is saved — a few rows of a board. */}
            <div data-display-preview="true" {...atmDisplayScopeProps(draft, true)}>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                {t('atm.settings.display.preview')}
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60">
                    <tr>
                      {(['bank', 'machineId', 'machineName', 'area'] as const).map((key) => (
                        <th
                          key={key}
                          className="px-3 py-2 text-start text-xs font-semibold text-slate-600 dark:text-slate-300"
                        >
                          {t(`atm.common.${key}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SAMPLE_ROWS.map((row) => (
                      <tr key={row[1]} className="border-t border-slate-100 dark:border-slate-800">
                        {row.map((cell) => (
                          <td key={cell} className="px-3 py-2 text-slate-700 dark:text-slate-200">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                disabled={save.isPending || sameDisplay(draft, ATM_DEFAULT_DISPLAY)}
                onClick={() => setDraft(ATM_DEFAULT_DISPLAY)}
              >
                {t('atm.settings.display.reset')}
              </Button>
              <Button
                loading={save.isPending}
                disabled={sameDisplay(draft, stored)}
                onClick={() => write(draft)}
              >
                {t('common.save')}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
};
