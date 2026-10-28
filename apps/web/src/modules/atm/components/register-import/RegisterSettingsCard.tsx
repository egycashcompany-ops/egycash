// The register's settings, edited where the import is run (spec §8.6, DEC-20).
//
//   · Branch codes — the workbook's `EGYCASH-1..7` → the ECMS branch (D4). Nothing is pre-filled:
//     which branch «وصال» is, is the administrator's act (EG-18). An unmapped code blocks the
//     import (`branchUnmapped`) and refuses a receipt in that branch (DEC-10). With the import
//     preview, this card is where the codes are spoken — every other screen names the ECMS branch,
//     as the top bar does. The card saves the RAW branch picked for each code; when that branch is
//     linked to work as another (`atm.branchLinks`), the code's rows are filed and shown under the
//     other one, and the row says so under the branch: «أكتوبر», then «يعمل باسم المهندسين». It
//     never saves the resolved branch — two codes would then name one branch, which the setting
//     refuses.
//   · The banks — shown, no longer edited here. The name a coupled Operations machine carries for
//     each bank (D5) is the bank CATALOG's now (DEC-35): the old `atm.register.bankLabels` setting
//     was read once, to seed the catalog, and is never read again, so an editor for it here would
//     save values nothing reads. The list shows what the import's preview will use, and «إدارة
//     البنوك» opens the register's own «البنوك» for whoever keeps the catalog.
//
// Written through the platform `setting.edit` at organization scope (the generic settings screen
// cannot edit an array of objects). Without `setting.edit` the card is READ-ONLY rather than
// hidden: an importer needs to see the mapping the preview will use.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ATM_REGISTER_BRANCH_CODES,
  AtmSettingKeys,
  type AtmRegisterBranchCode,
  type AtmRegisterMetaDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Can, useCan } from '../../../../platform/rbac/Can';
import { useSetSetting } from '../../../../platform/settings/settings-api';
import { useBranchOptions } from '../../../organization/shared/references';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { Select } from '../../../../shared/ui/form';
import { BuildingIcon, LinkIcon } from '../../../../shared/ui/icons';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { registerKeys, useRegisterMeta } from '../../api/register-queries';
import { sortByCatalogOrder } from '../../lib/bank-catalog';
import { worksAsTarget } from '../../lib/register-import-view';
import { branchLabel } from '../../lib/register-labels';
import { BankCatalogDialog } from '../catalog/BankCatalogDialog';
import { registerBranchChoices } from '../register/RegisterFilters';

const TH = 'p-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400';
const TD = 'p-2 align-middle';

/**
 * What a save of the mapping makes stale: the meta — this card, the register's branch filter and
 * the receipt's branches — and the entries and the Data Report, whose codes and branch sections
 * the mapping decides. The card used to refresh the meta alone, so the report kept counting a code
 * under the branch it had just been moved off.
 */
export const REGISTER_MAPPING_STALES = [
  registerKeys.meta,
  registerKeys.entries,
  registerKeys.report,
] as const;

type BranchDraft = Record<AtmRegisterBranchCode, string>;

/** «يعمل باسم …» under a code's branch — the branch its rows are filed under instead. */
const WorksAsMark = ({
  code,
  target,
}: {
  code: AtmRegisterBranchCode;
  target: string | null;
}): JSX.Element | null => {
  const t = useT();
  return target === null ? null : (
    <p
      data-register-settings-works-as={code}
      title={t('atm.registerSettings.worksAsHint', { target })}
      className="mt-1 flex items-center gap-1 text-xs text-sky-700 dark:text-sky-300"
    >
      <LinkIcon className="h-3 w-3 shrink-0" />
      <span>{t('atm.registerSettings.worksAs', { target })}</span>
    </p>
  );
};

const branchDraftOf = (meta: AtmRegisterMetaDto | undefined): BranchDraft =>
  Object.fromEntries(
    ATM_REGISTER_BRANCH_CODES.map((code) => [
      code,
      meta?.branches.find((b) => b.code === code)?.branchId ?? '',
    ]),
  ) as BranchDraft;

const signatureOf = (meta: AtmRegisterMetaDto | undefined): string =>
  JSON.stringify(branchDraftOf(meta));

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
  const [followed, setFollowed] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  // Follow the server once it answers and after every save — keyed on content, so a refetch that
  // returns the same values does not throw away an edit in progress.
  const serverSignature = signatureOf(meta.data);
  useEffect(() => {
    if (meta.data === undefined || followed === serverSignature) return;
    setFollowed(serverSignature);
    setBranchDraft(branchDraftOf(meta.data));
  }, [meta.data, serverSignature, followed]);

  const dirty = JSON.stringify(branchDraft) !== serverSignature;
  // Every catalog bank, archived ones too: the preview still names a row that carries one.
  const banks = sortByCatalogOrder(meta.data?.banks ?? []);

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
      await Promise.all(
        REGISTER_MAPPING_STALES.map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
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
  /** A branch is mapped to one code at most (the setting's own rule — on the raw branches). */
  const takenElsewhere = (code: AtmRegisterBranchCode, branchId: string): boolean =>
    ATM_REGISTER_BRANCH_CODES.some((other) => other !== code && branchDraft[other] === branchId);
  /**
   * The branch a code's rows go to when the branch picked for it works as another: the server's
   * answer for the saved mapping; for a branch just picked, a link the meta already knows of
   * (`sourceBranchIds`) — else nothing until the save answers.
   */
  const worksAs = (code: AtmRegisterBranchCode): string | null => {
    const picked = branchDraft[code];
    if (picked === '') return null;
    const saved = meta.data?.branches.find((b) => b.code === code);
    if (saved?.branchId === picked) return worksAsTarget(saved, locale, t);
    const target = registerBranchChoices(meta.data).find(
      (b) => b.branchId !== picked && b.sourceBranchIds.includes(picked),
    );
    return target === undefined ? null : localized(target.name, locale);
  };

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
                      <WorksAsMark code={code} target={worksAs(code)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2" data-register-settings-banks="true">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('atm.registerSettings.bankLabels')}
            </h4>
            <Can anyOf={['atmBank.create', 'atmBank.edit']}>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<BuildingIcon className="h-4 w-4" />}
                data-register-settings-action="banks"
                onClick={() => setCatalogOpen(true)}
              >
                {t('atm.registerSettings.manageBanks')}
              </Button>
            </Can>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('atm.registerSettings.bankLabelsHint')}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>{t('atm.registerSettings.bank')}</th>
                  <th className={TH}>{t('atm.registerSettings.bankName')}</th>
                  <th className={TH}>{t('atm.registerSettings.label')}</th>
                  <th className={TH}>{t('atm.dataEdit.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {banks.map((bank) => (
                  <tr key={bank.code} data-register-settings-bank={bank.code}>
                    <td className={`${TD} font-mono text-xs`} dir="ltr">
                      {bank.code}
                    </td>
                    <td className={TD}>
                      <span dir="auto">{localized(bank.name, locale)}</span>
                    </td>
                    <td className={TD}>
                      <span dir="ltr">{bank.opsLabel}</span>
                    </td>
                    <td className={TD}>
                      <StatusBadge
                        tone={bank.isActive ? 'success' : 'neutral'}
                        label={t(bank.isActive ? 'atm.dataEdit.active' : 'atm.dataEdit.archived')}
                      />
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
              disabled={!dirty || meta.data === undefined}
              onClick={() => void submit()}
            >
              {t('atm.registerSettings.save')}
            </Button>
          </div>
        )}
      </CardBody>
      {catalogOpen && <BankCatalogDialog open onClose={() => setCatalogOpen(false)} />}
    </Card>
  );
};
