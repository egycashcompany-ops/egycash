// The register's two settings, edited where the import is run (spec §8.6, DEC-20).
//
//   · Branch codes — the workbook's `EGYCASH-1..7` → the ECMS branch (D4). Nothing is pre-filled:
//     which branch «وصال» is, is the administrator's act (EG-18). An unmapped code blocks the
//     import (`branchUnmapped`) and refuses a receipt in that branch (DEC-10).
//   · Operations bank labels — the name a coupled Operations machine carries for each bank (D5).
//
// Written through the platform `setting.edit` at organization scope (the generic settings screen
// cannot edit an array of objects). Without `setting.edit` the card is READ-ONLY rather than
// hidden: an importer needs to see the mapping the preview will use.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ATM_BANK_CODES,
  ATM_DEFAULT_OPS_BANK_LABELS,
  ATM_REGISTER_BRANCH_CODES,
  AtmSettingKeys,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterMetaDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useSetSetting } from '../../../../platform/settings/settings-api';
import { useBranchOptions } from '../../../organization/shared/references';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { Input, Select } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { registerKeys, useRegisterMeta } from '../../api/register-queries';
import { bankName, branchLabel } from '../../lib/register-labels';

const TH = 'p-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400';
const TD = 'p-2 align-middle';

type BranchDraft = Record<AtmRegisterBranchCode, string>;
type LabelDraft = Record<AtmBankCode, string>;

const branchDraftOf = (meta: AtmRegisterMetaDto | undefined): BranchDraft =>
  Object.fromEntries(
    ATM_REGISTER_BRANCH_CODES.map((code) => [
      code,
      meta?.branches.find((b) => b.code === code)?.branchId ?? '',
    ]),
  ) as BranchDraft;

const labelDraftOf = (meta: AtmRegisterMetaDto | undefined): LabelDraft =>
  Object.fromEntries(
    ATM_BANK_CODES.map((code) => [
      code,
      meta?.banks.find((b) => b.code === code)?.opsLabel ?? ATM_DEFAULT_OPS_BANK_LABELS[code],
    ]),
  ) as LabelDraft;

const signatureOf = (meta: AtmRegisterMetaDto | undefined): string =>
  JSON.stringify([branchDraftOf(meta), labelDraftOf(meta)]);

export const RegisterSettingsCard = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const canEdit = can('setting.edit');

  const meta = useRegisterMeta();
  const branches = useBranchOptions(canEdit);
  const save = useSetSetting();

  const [branchDraft, setBranchDraft] = useState<BranchDraft>(() => branchDraftOf(meta.data));
  const [labelDraft, setLabelDraft] = useState<LabelDraft>(() => labelDraftOf(meta.data));
  const [followed, setFollowed] = useState<string | null>(null);
  // Follow the server once it answers and after every save — keyed on content, so a refetch that
  // returns the same values does not throw away an edit in progress.
  const serverSignature = signatureOf(meta.data);
  useEffect(() => {
    if (meta.data === undefined || followed === serverSignature) return;
    setFollowed(serverSignature);
    setBranchDraft(branchDraftOf(meta.data));
    setLabelDraft(labelDraftOf(meta.data));
  }, [meta.data, serverSignature, followed]);

  const dirty = JSON.stringify([branchDraft, labelDraft]) !== serverSignature;
  const labelsComplete = ATM_BANK_CODES.every((code) => labelDraft[code].trim() !== '');

  const submit = async (): Promise<void> => {
    try {
      await save.mutateAsync({
        key: AtmSettingKeys.RegisterBranchCodes,
        scope: 'organization',
        value: ATM_REGISTER_BRANCH_CODES.filter((code) => branchDraft[code] !== '').map((code) => ({
          code,
          branchId: branchDraft[code],
        })),
      });
      await save.mutateAsync({
        key: AtmSettingKeys.RegisterBankLabels,
        scope: 'organization',
        value: ATM_BANK_CODES.map((bankCode) => ({ bankCode, label: labelDraft[bankCode].trim() })),
      });
      await qc.invalidateQueries({ queryKey: registerKeys.meta });
      toast.success(t('atm.registerSettings.saved'));
    } catch {
      // Already said: `useSetSetting` declares no `onError`, so the global handler toasts this
      // failure in the reader's language — a second toast here repeated it (review WEB-1).
    }
  };

  const mappedName = (code: AtmRegisterBranchCode): string => {
    const row = meta.data?.branches.find((b) => b.code === code);
    return row?.branchName === null || row?.branchName === undefined
      ? '—'
      : localized(row.branchName, locale);
  };
  /** A branch is mapped to one code at most (the setting's own rule). */
  const takenElsewhere = (code: AtmRegisterBranchCode, branchId: string): boolean =>
    ATM_REGISTER_BRANCH_CODES.some((other) => other !== code && branchDraft[other] === branchId);

  return (
    <Card>
      <CardHeader title={t('atm.registerSettings.title')} />
      <CardBody className="space-y-5">
        {!canEdit && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('atm.registerSettings.readOnly')}
          </p>
        )}
        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('atm.registerSettings.branchCodes')}
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>{t('atm.registerSettings.code')}</th>
                  <th className={TH}>{t('atm.registerSettings.sheetName')}</th>
                  <th className={TH}>{t('atm.registerSettings.branch')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ATM_REGISTER_BRANCH_CODES.map((code) => (
                  <tr key={code}>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`} dir="ltr">
                      {code}
                    </td>
                    <td className={TD}>
                      <span dir="auto">{branchLabel(code, 'ar')}</span>
                    </td>
                    <td className={TD}>
                      {canEdit ? (
                        <Select
                          aria-label={`${t('atm.registerSettings.branch')} ${code}`}
                          value={branchDraft[code]}
                          disabled={save.isPending}
                          onChange={(e) =>
                            setBranchDraft((prev) => ({ ...prev, [code]: e.target.value }))
                          }
                        >
                          <option value="">{t('atm.registerSettings.pickBranch')}</option>
                          {(branches.data ?? []).map((branch) => (
                            <option
                              key={branch.id}
                              value={branch.id}
                              disabled={takenElsewhere(code, branch.id)}
                            >
                              {localized(branch.name, locale)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span dir="auto">{mappedName(code)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('atm.registerSettings.bankLabels')}
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>{t('atm.registerSettings.bank')}</th>
                  <th className={TH}>{t('atm.registerSettings.bankName')}</th>
                  <th className={TH}>{t('atm.registerSettings.label')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ATM_BANK_CODES.map((code) => (
                  <tr key={code}>
                    <td className={`${TD} font-mono text-xs`} dir="ltr">
                      {code}
                    </td>
                    <td className={TD}>
                      <span dir="auto">{bankName(code, 'ar')}</span>
                    </td>
                    <td className={TD}>
                      {canEdit ? (
                        <Input
                          aria-label={`${t('atm.registerSettings.label')} ${code}`}
                          dir="ltr"
                          maxLength={64}
                          value={labelDraft[code]}
                          disabled={save.isPending}
                          onChange={(e) =>
                            setLabelDraft((prev) => ({ ...prev, [code]: e.target.value }))
                          }
                        />
                      ) : (
                        <span dir="ltr">{labelDraft[code]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {canEdit && (
          <div className="flex justify-end">
            <Button
              loading={save.isPending}
              disabled={!dirty || !labelsComplete || meta.data === undefined}
              onClick={() => void submit()}
            >
              {t('atm.registerSettings.save')}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
};
