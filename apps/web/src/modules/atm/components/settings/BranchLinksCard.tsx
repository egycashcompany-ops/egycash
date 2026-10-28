// «فروع تعمل معاً» — the ATM-only branch links (`atm.branchLinks`). The owner (2026-10-28):
// «فرع أكتوبر شغال هو والمهندسين مع بعض بكل بياناتهم والبيانات دي متسجله إنها المهندسين — يعني
// أكتوبر هيشوف شغل المهندسين ويشتغل معاهم عادى والمهندسين شايف أكتوبر إنه شغال معاه بردو».
//
// A link is DIRECTED: the first branch works AS the second — on an ATM request its people are
// answered as the second branch's, and what they record is filed under it. So each row reads as
// one sentence, «أكتوبر ← يعمل باسم المهندسين», rather than as two equal columns.
//
// Every add and remove writes the whole list at once (PUT /atm/branch-links): a link is a fact on
// its own, with nothing else on the card to save beside it. The add row checks the list with the
// contract's own rules (`atmBranchLinkIssues`) before anything is sent, so the reader learns why a
// pair cannot be linked without a round trip; whether both branches still exist is the server's.
import { useState } from 'react';
import {
  atmBranchLinkIssues,
  type AtmBranchLink,
  type AtmBranchLinkIssue,
  type Locale,
  type LocalizedString,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { useBranchOptions } from '../../../organization/shared/references';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { Field, Select } from '../../../../shared/ui/form';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { PlusIcon, TrashIcon } from '../../../../shared/ui/icons';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { useAtmBranchLinks, useSaveAtmBranchLinks } from '../../api/settings-queries';

/**
 * Why the list would refuse this pair — the first rule `[...links, candidate]` breaks, wherever
 * it lands: a pair that turns an existing row into a chain is refused as much as one that is one.
 */
export const branchLinkRefusal = (
  links: readonly AtmBranchLink[],
  candidate: AtmBranchLink,
): AtmBranchLinkIssue | null => atmBranchLinkIssues([...links, candidate])[0]?.issue ?? null;

export const BranchLinksCard = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const links = useAtmBranchLinks();
  const branchOptions = useBranchOptions();
  const save = useSaveAtmBranchLinks();
  const [branchId, setBranchId] = useState('');
  const [actsAsBranchId, setActsAsBranchId] = useState('');

  const rows = links.data?.links ?? [];
  const current: AtmBranchLink[] = rows.map((row) => ({
    branchId: row.branchId,
    actsAsBranchId: row.actsAsBranchId,
  }));
  const candidate = branchId !== '' && actsAsBranchId !== '' ? { branchId, actsAsBranchId } : null;
  const refusal = candidate === null ? null : branchLinkRefusal(current, candidate);

  /** The server's name; the branch list's when the server had none to give. */
  const nameOf = (id: string, fromServer: LocalizedString | null): string => {
    const name = fromServer ?? branchOptions.data?.find((branch) => branch.id === id)?.name ?? null;
    return name === null ? t('atm.settings.unknownBranch') : localized(name, locale);
  };

  const write = async (next: AtmBranchLink[], doneKey: string): Promise<boolean> => {
    try {
      await save.mutateAsync({ links: next });
      toast.success(t(doneKey));
      return true;
    } catch {
      // Toasted by the global handler — the save declares no `onError`.
      return false;
    }
  };

  const add = async (): Promise<void> => {
    if (candidate === null || refusal !== null) return;
    if (await write([...current, candidate], 'atm.settings.links.added')) {
      setBranchId('');
      setActsAsBranchId('');
    }
  };

  const options = (branchOptions.data ?? []).map((branch) => (
    <option key={branch.id} value={branch.id}>
      {localized(branch.name, locale)}
    </option>
  ));

  return (
    <Card>
      <CardHeader
        title={t('atm.settings.links.title')}
        description={t('atm.settings.links.hint')}
      />
      <CardBody className="space-y-4">
        {links.isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : links.isError ? (
          <ErrorState error={links.error} onRetry={() => void links.refetch()} />
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                {t('atm.settings.links.none')}
              </p>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => {
                  const branch = nameOf(row.branchId, row.branchName);
                  return (
                    <li
                      key={row.branchId}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
                      data-branch-link={row.branchId}
                    >
                      <span className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">
                        {t('atm.settings.links.row', {
                          branch,
                          target: nameOf(row.actsAsBranchId, row.actsAsBranchName),
                        })}
                      </span>
                      <Button
                        variant="ghost-danger"
                        size="sm"
                        aria-label={t('atm.settings.links.remove', { branch })}
                        disabled={save.isPending}
                        data-branch-links-action="remove"
                        onClick={() =>
                          void write(
                            current.filter((link) => link.branchId !== row.branchId),
                            'atm.settings.links.removed',
                          )
                        }
                      >
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-3">
                <Field
                  label={t('atm.settings.links.branch')}
                  htmlFor="atm-link-branch"
                  className="min-w-40 flex-1"
                >
                  <Select
                    id="atm-link-branch"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                  >
                    <option value="">{t('atm.settings.pickBranch')}</option>
                    {options}
                  </Select>
                </Field>
                <Field
                  label={t('atm.settings.links.actsAs')}
                  htmlFor="atm-link-acts-as"
                  className="min-w-40 flex-1"
                >
                  <Select
                    id="atm-link-acts-as"
                    value={actsAsBranchId}
                    onChange={(e) => setActsAsBranchId(e.target.value)}
                  >
                    <option value="">{t('atm.settings.pickBranch')}</option>
                    {options}
                  </Select>
                </Field>
                <Button
                  variant="secondary"
                  leftIcon={<PlusIcon className="h-4 w-4" />}
                  loading={save.isPending}
                  disabled={candidate === null || refusal !== null}
                  data-branch-links-action="add"
                  onClick={() => void add()}
                >
                  {t('atm.settings.links.add')}
                </Button>
              </div>
              {refusal !== null && (
                <p
                  role="alert"
                  className="text-xs text-red-600 dark:text-red-400"
                  data-branch-link-refusal={refusal}
                >
                  {t(`atm.settings.links.issue.${refusal}`)}
                </p>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
};
