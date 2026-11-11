// «نقل إلى فرع» — «عايز إمكانية نقل أصل أو مستهلك إلى فرع تاني» (2026-11-11). One dialog for the
// register's several assets and the asset page's one: the branch they go to, when, and why — and
// every asset listed with what the move does to it.
//
// The owner's answers are its shape: recorded at once («فوراً»), no «in transit» and no confirming
// at the other end; no paper («لا، السجل كفاية»), the asset's history is the record; several at
// once («كذا حاجة مرة واحدة»), to ONE branch; and an asset held by an employee moves too — «ينتقل
// مع عهدته»: its custody goes with it and the holder keeps it, which the dialog says before it is
// sent. What the server would refuse — disposed, under maintenance, already in the chosen branch —
// is shown as staying, with the reason, and left out of the request (`lib/asset-branch-move.ts`);
// the server still decides the rest, all or none. The branches offered are the ones the SERVER says
// the caller's `itAsset.assign` reaches (`GET /it/assets/move-targets`) — it answers 403 for any
// other, and `me` cannot tell them apart (`lib/branch-move-targets.ts`).
import { useEffect, useMemo, useState } from 'react';
import { IT_ASSET_MOVE_MAX, type ItAssetDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { BuildingIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { formatNumber, localized } from '../../../shared/lib/format';
import { useItBranchOptions, useItMoveTargets, useMoveItAssetsToBranch } from '../api/it-queries';
import {
  assetMoveEligibility,
  assetMovePlan,
  assetMoveRequest,
  assetsMovedWords,
  sharedBranch,
} from '../lib/asset-branch-move';
import { branchMoveTargets } from '../lib/branch-move-targets';

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`; an empty string means "let the server stamp now". */
const nowLocal = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

export const AssetBranchMoveDialog = ({
  open,
  onClose,
  assets,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  /** The assets picked on the register, or the one asset of its page — in the order picked. */
  assets: readonly ItAssetDto[];
  /** After the move is recorded — the register clears its selection. */
  onMoved?: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  const reach = useItMoveTargets(open);
  const move = useMoveItAssetsToBranch();
  const [toBranchId, setToBranchId] = useState('');
  const [at, setAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setToBranchId('');
      setAt(nowLocal());
      setNotes('');
      setError(null);
    }
  }, [open]);

  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);

  // Only a branch the server says the custody grant reaches — it answers 403 for any other. And
  // where every one of them already is is no destination; with several branches among them, each
  // branch is somewhere for the others, and the ones already there are shown as staying. Null
  // while either list is on its way: the picker waits instead of saying there is nowhere to go.
  const targets = branchMoveTargets(branches.data, reach.data?.branchIds, sharedBranch(assets));
  const noTarget = targets !== null && targets.length === 0;
  const unread = targets === null ? (reach.error ?? branches.error) : null;
  // A choice no longer offered is no choice: nothing is sent to it.
  const chosen = targets?.some((branch) => branch.id === toBranchId) === true ? toBranchId : '';
  const plan = assetMovePlan(assets, chosen);
  const request = assetMoveRequest(plan, chosen, at, notes);
  const single = assets.length === 1 ? assets[0] : undefined;

  const submit = async (): Promise<void> => {
    if (request === null) return;
    setError(null);
    try {
      const result = await move.mutateAsync(request);
      toast.success(
        assetsMovedWords(
          t,
          locale,
          result.moved.length,
          branchName.get(result.toBranchId) ?? t('it.assets.move.theBranch'),
        ),
      );
      onMoved?.();
      onClose();
    } catch (err) {
      // The request's own failure is toasted once, by the client's global handler; the dialog
      // stays open and says why beside the form, as every custody dialog does.
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      // A dialog that is FILLED IN keeps its typing: only the × and Escape close it.
      dismissOnOutsideClick={false}
      title={t('it.assets.move.title')}
      description={
        single === undefined ? t('it.assets.move.hint') : `${single.assetCode} — ${single.name}`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            leftIcon={<BuildingIcon className="h-4 w-4" />}
            loading={move.isPending}
            disabled={request === null}
            onClick={() => void submit()}
          >
            {t('it.assets.move.submit', { n: formatNumber(plan.movable.length, locale) })}
          </Button>
        </>
      }
    >
      {error !== null && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <div className="space-y-4">
        {single !== undefined && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('it.assets.move.hint')}</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('it.assets.move.toBranch')}
            required
            error={
              noTarget
                ? t('it.assets.move.noTarget')
                : unread !== null
                  ? errorMessage(unread, locale)
                  : undefined
            }
          >
            <Select
              value={chosen}
              disabled={targets === null || noTarget}
              onChange={(e) => setToBranchId(e.target.value)}
            >
              <option value="">
                {targets === null && unread === null
                  ? t('common.loading')
                  : t('it.consumables.chooseBranch')}
              </option>
              {(targets ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {localized(branch.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('it.assets.move.at')}>
            <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
        </div>

        {plan.anyHeld && (
          <p
            role="note"
            data-move-held-note
            className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
          >
            {t('it.assets.move.heldNote')}
          </p>
        )}
        {plan.tooMany && (
          <p
            role="note"
            className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {t('it.assets.move.tooMany', { max: formatNumber(IT_ASSET_MOVE_MAX, locale) })}
          </p>
        )}

        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {t('it.assets.move.assets', { n: formatNumber(assets.length, locale) })}
          </h4>
          <ul className="max-h-72 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {assets.map((asset) => {
              const verdict = assetMoveEligibility(asset, chosen);
              const holder = asset.holder;
              return (
                <li
                  key={asset.id}
                  data-move-asset={asset.id}
                  data-move-state={verdict.movable ? 'moves' : verdict.reason}
                  className="flex flex-wrap items-start justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800 dark:text-slate-100">
                      <bdi className="font-mono text-xs text-slate-500" dir="ltr">
                        {asset.assetCode}
                      </bdi>{' '}
                      {asset.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {branchName.get(asset.branchId) ?? '—'}
                      {' · '}
                      {holder === null
                        ? t('it.assets.move.inStore')
                        : t('it.assets.move.heldBy', {
                            name:
                              holder.employeeName === null
                                ? (holder.employeeCode ?? holder.employeeId)
                                : holder.employeeCode === null
                                  ? holder.employeeName
                                  : `${holder.employeeName} (${holder.employeeCode})`,
                          })}
                    </p>
                  </div>
                  {verdict.movable ? (
                    verdict.held ? (
                      <Badge size="sm" tone="info">
                        {t('it.assets.move.withCustody')}
                      </Badge>
                    ) : null
                  ) : (
                    <Badge
                      size="sm"
                      tone={verdict.reason === 'alreadyThere' ? 'neutral' : 'warning'}
                    >
                      {t(`it.assets.move.refused.${verdict.reason}`)}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
          {plan.refused.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('it.assets.move.leftOut')}
            </p>
          )}
        </section>

        <Field label={t('it.assets.fields.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
