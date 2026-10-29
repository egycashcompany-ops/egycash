// «بريد الصيانة — بنك مصر» — the one mailbox the central reader polls every minute. The owner
// (2026-10-28): ONE shared mailbox for every branch, the branches switched on one at a time
// («هنبدأ بفرع المهندسين حالياً وبعدين هنبقى نزود فرع فرع»), and the credentials typed on a screen
// with the secret stored encrypted — never in code.
//
// The whole card is ONE save (PUT /atm/mailbox carries every field and the branch list). The
// secret box is never filled from the server — the server never sends it; `hasSecret` turns the
// box's hint into «محفوظ — اتركه فارغاً للإبقاء عليه», and an empty box keeps what is stored.
// «اختبار الاتصال» and «قراءة الآن» act on what is STORED, so they wait until the card is saved:
// a result for settings still unsaved on screen would answer a question nobody asked.
//
// A branch linked to work as another («أكتوبر ← يعمل باسم المهندسين», the card below) has its
// machines' mail filed under the target, so the save keeps the TARGET's row in its place (or drops
// it when the target is switched on already). Such a row is marked as soon as it is on the list,
// before the save turns it into another branch's row — with the mark the save will bear out — and
// after the save the card shows the rows the server kept.
import { useEffect, useState } from 'react';
import {
  SaveAtmMailboxConfigSchema,
  type AtmBranchLinkDto,
  type AtmMailboxConfigDto,
  type AtmMailPollRunDto,
  type Locale,
  type LocalizedString,
  type SaveAtmMailboxConfigInput,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { useBranchOptions } from '../../../organization/shared/references';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { Field, Input, Select, Switch } from '../../../../shared/ui/form';
import { PasswordInput } from '../../../../shared/ui/PasswordInput';
import { StatStrip } from '../../../../shared/ui/StatStrip';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { MissingFieldsBanner, useRequiredFields } from '../../../../shared/ui/required-fields';
import { PlusIcon, TrashIcon } from '../../../../shared/ui/icons';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatBusinessDateTime, formatNumber, localized } from '../../../../shared/lib/format';
import {
  useAtmBranchLinks,
  useAtmMailboxConfig,
  usePollAtmMailboxNow,
  useSaveAtmMailboxConfig,
  useTestAtmMailbox,
} from '../../api/settings-queries';

const TH = 'p-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400';
const TD = 'p-2 align-middle';

/** The counts of one run, in the order the reader takes a message through. */
const RUN_COUNTS = ['read', 'created', 'duplicates', 'unmatched', 'failed'] as const;

/** The three boxes whose format the contract checks — each has its own «why» line. */
type CheckedField = 'tenantId' | 'clientId' | 'userEmail';

interface Draft {
  tenantId: string;
  clientId: string;
  /** Typed only to REPLACE the stored secret; never filled from the server. */
  clientSecret: string;
  userEmail: string;
  enabled: boolean;
  branches: { branchId: string; category: string | null }[];
}

export const mailboxDraftOf = (config: AtmMailboxConfigDto | null): Draft => ({
  tenantId: config?.tenantId ?? '',
  clientId: config?.clientId ?? '',
  clientSecret: '',
  userEmail: config?.userEmail ?? '',
  enabled: config?.enabled ?? false,
  branches: (config?.branches ?? []).map(({ branchId, category }) => ({ branchId, category })),
});

/**
 * Pure: the rows a save removes — the server's own rule (`mailboxBranchesFiledAs`). A linked
 * source's row is saved as its target's row, unless the target already has a row on the list (or
 * an earlier source row became it): then the save drops this one, and that row keeps its category.
 */
export const mailboxRowsRemovedOnSave = (
  rows: readonly { branchId: string }[],
  targetOf: (branchId: string) => string | null,
): Set<string> => {
  const listed = new Set(rows.map((row) => row.branchId));
  const kept = new Set<string>();
  const removed = new Set<string>();
  for (const row of rows) {
    const target = targetOf(row.branchId) ?? row.branchId;
    if ((target !== row.branchId && listed.has(target)) || kept.has(target)) {
      removed.add(row.branchId);
      continue;
    }
    kept.add(target);
  }
  return removed;
};

/** What the save compares — a secret of blanks is no secret, as the schema reads it. */
const signatureOf = (draft: Draft): string =>
  JSON.stringify({ ...draft, clientSecret: draft.clientSecret.trim() });

/** The PUT body: the secret only when one was typed (absent = keep the stored one). */
export const mailboxSaveBody = (
  draft: Draft,
  version: number | null,
): SaveAtmMailboxConfigInput => ({
  tenantId: draft.tenantId.trim(),
  clientId: draft.clientId.trim(),
  ...(draft.clientSecret.trim() === '' ? {} : { clientSecret: draft.clientSecret.trim() }),
  userEmail: draft.userEmail.trim(),
  enabled: draft.enabled,
  branches: draft.branches,
  version,
});

/**
 * A secret has to be typed only when reading is switched on and none is stored — the server's own
 * rule: switched on with no secret anywhere, the reader could only fail every minute. Switched
 * off, the card saves without one (to stop the deployment's reading, or to finish it later).
 */
export const secretMissing = (draft: Draft, hasSecret: boolean): boolean =>
  draft.enabled && !hasSecret && draft.clientSecret.trim() === '';

/** Would the save accept this value? The contract's own rule for the field, not a copy of it. */
const fieldOk = (field: CheckedField, value: string): boolean =>
  SaveAtmMailboxConfigSchema.shape[field].safeParse(value).success;

/** The run to show: the one «قراءة الآن» just answered, unless the card already has a later one. */
const latestRun = (
  stored: AtmMailPollRunDto | null,
  justRun: AtmMailPollRunDto | undefined,
): AtmMailPollRunDto | null => {
  if (justRun === undefined) return stored;
  if (stored === null) return justRun;
  return Date.parse(justRun.at) >= Date.parse(stored.at) ? justRun : stored;
};

/** The last run: when it started (Cairo), its five counts, why it failed, why mail was left. */
const LastPoll = ({ run }: { run: AtmMailPollRunDto | null }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <section className="space-y-2" data-mailbox-last-poll="true">
      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {t('atm.settings.mailbox.lastPoll')}
      </h4>
      {run === null ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('atm.settings.mailbox.neverPolled')}
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('atm.settings.mailbox.lastPollAt', { at: formatBusinessDateTime(run.at, locale) })}
          </p>
          <StatStrip
            columns={5}
            items={RUN_COUNTS.map((key) => ({
              key,
              label: t(`atm.settings.mailbox.counts.${key}`),
              value: formatNumber(run[key], locale),
            }))}
          />
          {run.error !== null && (
            <p className="text-sm text-red-600 dark:text-red-400" data-mailbox-poll-error="true">
              {t('atm.settings.mailbox.pollFailed', { error: run.error })}
            </p>
          )}
          {run.unmatchedReasons.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('atm.settings.mailbox.unmatchedReasons')}
              </p>
              <ul className="list-disc space-y-0.5 ps-5 text-xs text-slate-600 dark:text-slate-300">
                {run.unmatchedReasons.map((reason, index) => (
                  <li key={`${String(index)}-${reason}`} dir="auto">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
};

/** The form, mounted once the GET has answered — `stored` is the document, or null for none. */
const MailboxForm = ({ stored }: { stored: AtmMailboxConfigDto | null }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branchOptions = useBranchOptions();
  const links = useAtmBranchLinks();
  const save = useSaveAtmMailboxConfig();
  const test = useTestAtmMailbox();
  const poll = usePollAtmMailboxNow();

  const [draft, setDraft] = useState<Draft>(() => mailboxDraftOf(stored));
  const [addBranchId, setAddBranchId] = useState('');
  const [addCategory, setAddCategory] = useState('');

  // Follow the server after every save — keyed on content, so a refetch that returns the same
  // values does not throw away an edit in progress (the register settings card's rule).
  const serverSignature = signatureOf(mailboxDraftOf(stored));
  const [followed, setFollowed] = useState(serverSignature);
  useEffect(() => {
    if (followed === serverSignature) return;
    setFollowed(serverSignature);
    setDraft(mailboxDraftOf(stored));
  }, [stored, serverSignature, followed]);

  const set = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }));
  const dirty = signatureOf(draft) !== serverSignature;
  const hasSecret = stored?.hasSecret === true;
  // Both act on the STORED document; the reading also needs it switched on (the server refuses
  // «قراءة الآن» while reading is off, and a vague refusal would say less than this button does).
  const canTest = stored !== null && !dirty;
  const canRead = canTest && stored.enabled;

  const required = useRequiredFields(
    [
      {
        key: 'tenantId',
        label: t('atm.settings.mailbox.tenantId'),
        ok: fieldOk('tenantId', draft.tenantId),
      },
      {
        key: 'clientId',
        label: t('atm.settings.mailbox.clientId'),
        ok: fieldOk('clientId', draft.clientId),
      },
      {
        key: 'clientSecret',
        label: t('atm.settings.mailbox.clientSecret'),
        ok: !secretMissing(draft, hasSecret),
      },
      {
        key: 'userEmail',
        label: t('atm.settings.mailbox.userEmail'),
        ok: fieldOk('userEmail', draft.userEmail),
      },
    ],
    stored,
  );
  /** Filled in and still refused: says why, where «حقل مطلوب» would be wrong. */
  const invalid = (key: CheckedField): string | undefined =>
    required.isMissing(key) && draft[key].trim() !== ''
      ? t(`atm.settings.mailbox.${key}Invalid`)
      : undefined;

  const submit = required.guard(async () => {
    try {
      const saved = await save.mutateAsync(mailboxSaveBody(draft, stored?.version ?? null));
      // The form shows what the server KEPT: a linked source's row comes back as its target's, or
      // not at all beside the target's own row. An answer equal to what was stored before would
      // leave that row on screen, unsaved, behind «تم الحفظ» — the follow above is keyed on
      // content and sees nothing new (review finding). `mailboxDraftOf` also empties the secret
      // box: a saved secret is never shown again.
      setDraft(mailboxDraftOf(saved));
      // A connection result was about the settings this save replaced.
      test.reset();
      toast.success(t('atm.common.saved'));
    } catch {
      // Already said: the save declares no `onError`, so the global handler toasts the refusal
      // in the reader's language — a second toast here would repeat it.
    }
  });

  const runTest = async (): Promise<void> => {
    try {
      const result = await test.mutateAsync();
      if (result.ok) {
        toast.success(t('atm.settings.mailbox.testOk', { count: result.unreadSample }));
      } else {
        toast.error(t('atm.settings.mailbox.testFailed', { error: result.error ?? '—' }));
      }
    } catch {
      // Toasted by the global handler.
    }
  };

  const runPoll = async (): Promise<void> => {
    try {
      const run = await poll.mutateAsync();
      if (run.error === null) {
        toast.success(t('atm.settings.mailbox.pollDone', { read: run.read, created: run.created }));
      } else {
        toast.error(t('atm.settings.mailbox.pollFailed', { error: run.error }));
      }
    } catch {
      // Toasted by the global handler.
    }
  };

  /** The server's name for a saved row; the branch list's for one added on this screen. */
  const branchName = (branchId: string): string => {
    const saved: LocalizedString | null | undefined = stored?.branches.find(
      (row) => row.branchId === branchId,
    )?.branchName;
    const name =
      saved ?? branchOptions.data?.find((branch) => branch.id === branchId)?.name ?? null;
    return name === null ? t('atm.settings.unknownBranch') : localized(name, locale);
  };
  /** The link a row's branch works through — none for a branch that works as itself. */
  const linkOf = (branchId: string): AtmBranchLinkDto | null =>
    links.data?.links.find((link) => link.branchId === branchId) ?? null;
  const targetName = (link: AtmBranchLinkDto): string => {
    const name =
      link.actsAsBranchName ??
      branchOptions.data?.find((branch) => branch.id === link.actsAsBranchId)?.name ??
      null;
    return name === null ? t('atm.settings.unknownBranch') : localized(name, locale);
  };
  const switchedOn = new Set(draft.branches.map((row) => row.branchId));
  const addable = (branchOptions.data ?? []).filter((branch) => !switchedOn.has(branch.id));
  const removedOnSave = mailboxRowsRemovedOnSave(
    draft.branches,
    (branchId) => linkOf(branchId)?.actsAsBranchId ?? null,
  );

  const addBranch = (): void => {
    if (addBranchId === '') return;
    const category = addCategory.trim();
    set({
      branches: [
        ...draft.branches,
        { branchId: addBranchId, category: category === '' ? null : category },
      ],
    });
    setAddBranchId('');
    setAddCategory('');
  };

  const testResult = test.data;

  return (
    <div className="space-y-5">
      {stored === null && (
        <p className="text-xs text-slate-500 dark:text-slate-400" data-mailbox-unsaved="true">
          {t('atm.settings.mailbox.notSaved')}
        </p>
      )}
      <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('atm.settings.mailbox.tenantId')}
          htmlFor="atm-mailbox-tenant"
          required
          missing={required.isMissing('tenantId')}
          error={invalid('tenantId')}
        >
          <Input
            id="atm-mailbox-tenant"
            value={draft.tenantId}
            onChange={(e) => set({ tenantId: e.target.value })}
            maxLength={100}
            autoComplete="off"
            dir="ltr"
          />
        </Field>
        <Field
          label={t('atm.settings.mailbox.clientId')}
          htmlFor="atm-mailbox-client"
          required
          missing={required.isMissing('clientId')}
          error={invalid('clientId')}
        >
          <Input
            id="atm-mailbox-client"
            value={draft.clientId}
            onChange={(e) => set({ clientId: e.target.value })}
            maxLength={36}
            autoComplete="off"
            dir="ltr"
          />
        </Field>
        <Field
          label={t('atm.settings.mailbox.clientSecret')}
          htmlFor="atm-mailbox-secret"
          required={draft.enabled && !hasSecret}
          missing={required.isMissing('clientSecret')}
          hint={hasSecret ? t('atm.settings.mailbox.secretStored') : undefined}
        >
          <PasswordInput
            id="atm-mailbox-secret"
            value={draft.clientSecret}
            onChange={(e) => set({ clientSecret: e.target.value })}
            maxLength={512}
            autoComplete="new-password"
            data-mailbox-secret="true"
          />
        </Field>
        <Field
          label={t('atm.settings.mailbox.userEmail')}
          htmlFor="atm-mailbox-address"
          required
          missing={required.isMissing('userEmail')}
          error={invalid('userEmail')}
        >
          <Input
            id="atm-mailbox-address"
            type="email"
            value={draft.userEmail}
            onChange={(e) => set({ userEmail: e.target.value })}
            maxLength={254}
            autoComplete="off"
            dir="ltr"
          />
        </Field>
      </div>

      <Switch
        label={t('atm.settings.mailbox.enabled')}
        description={t('atm.settings.mailbox.enabledHint')}
        checked={draft.enabled}
        onChange={(e) => set({ enabled: e.target.checked })}
        data-mailbox-enabled="true"
      />

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t('atm.settings.mailbox.branches')}
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('atm.settings.mailbox.branchesHint')}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>{t('atm.settings.mailbox.branch')}</th>
                <th className={TH}>{t('atm.settings.mailbox.category')}</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {draft.branches.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="py-4 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    {t('atm.settings.mailbox.noBranches')}
                  </td>
                </tr>
              ) : (
                draft.branches.map((row) => {
                  const name = branchName(row.branchId);
                  const link = linkOf(row.branchId);
                  return (
                    <tr key={row.branchId} data-mailbox-branch={row.branchId}>
                      <td className={TD}>
                        <span dir="auto">{name}</span>
                        {link !== null && (
                          <p
                            className="mt-0.5 text-xs text-amber-700 dark:text-amber-400"
                            data-mailbox-works-as={link.actsAsBranchId}
                          >
                            {t(
                              removedOnSave.has(row.branchId)
                                ? 'atm.settings.mailbox.worksAsListed'
                                : 'atm.settings.mailbox.worksAs',
                              { target: targetName(link) },
                            )}
                          </p>
                        )}
                      </td>
                      <td className={TD}>
                        <span dir="ltr">{row.category ?? '—'}</span>
                      </td>
                      <td className={`${TD} text-end`}>
                        <Button
                          variant="ghost-danger"
                          size="sm"
                          aria-label={t('atm.settings.mailbox.removeBranch', { branch: name })}
                          data-mailbox-action="remove-branch"
                          onClick={() =>
                            set({
                              branches: draft.branches.filter(
                                (other) => other.branchId !== row.branchId,
                              ),
                            })
                          }
                        >
                          <TrashIcon className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={t('atm.settings.mailbox.branch')}
            htmlFor="atm-mailbox-add-branch"
            className="min-w-40 flex-1"
          >
            <Select
              id="atm-mailbox-add-branch"
              value={addBranchId}
              onChange={(e) => setAddBranchId(e.target.value)}
            >
              <option value="">{t('atm.settings.pickBranch')}</option>
              {addable.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {localized(branch.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('atm.settings.mailbox.category')}
            htmlFor="atm-mailbox-add-category"
            className="min-w-40 flex-1"
          >
            <Input
              id="atm-mailbox-add-category"
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value)}
              maxLength={64}
              dir="ltr"
            />
          </Field>
          <Button
            variant="secondary"
            leftIcon={<PlusIcon className="h-4 w-4" />}
            disabled={addBranchId === ''}
            data-mailbox-action="add-branch"
            onClick={addBranch}
          >
            {t('atm.settings.mailbox.addBranch')}
          </Button>
        </div>
      </section>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            loading={test.isPending}
            disabled={!canTest || poll.isPending}
            data-mailbox-action="test"
            onClick={() => void runTest()}
          >
            {t('atm.settings.mailbox.test')}
          </Button>
          <Button
            variant="secondary"
            loading={poll.isPending}
            disabled={!canRead || test.isPending}
            data-mailbox-action="poll"
            onClick={() => void runPoll()}
          >
            {t('atm.settings.mailbox.pollNow')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!dirty}
            data-mailbox-action="save"
            onClick={submit}
          >
            {t('atm.common.save')}
          </Button>
        </div>
        {stored !== null && (dirty || !stored.enabled) && (
          <p className="text-end text-xs text-slate-500 dark:text-slate-400">
            {t(dirty ? 'atm.settings.mailbox.probeHint' : 'atm.settings.mailbox.readingOffHint')}
          </p>
        )}
        {testResult !== undefined && (
          <p
            className={
              testResult.ok
                ? 'text-sm text-emerald-700 dark:text-emerald-400'
                : 'text-sm text-red-600 dark:text-red-400'
            }
            data-mailbox-test={testResult.ok ? 'ok' : 'failed'}
          >
            {testResult.ok
              ? t('atm.settings.mailbox.testOk', { count: testResult.unreadSample })
              : t('atm.settings.mailbox.testFailed', { error: testResult.error ?? '—' })}
          </p>
        )}
      </div>

      <LastPoll run={latestRun(stored?.lastPoll ?? null, poll.data)} />
    </div>
  );
};

export const MailboxSettingsCard = (): JSX.Element => {
  const t = useT();
  const config = useAtmMailboxConfig();
  return (
    <Card>
      <CardHeader title={t('atm.settings.mailbox.title')} />
      <CardBody>
        {config.isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : config.isError ? (
          <ErrorState error={config.error} onRetry={() => void config.refetch()} />
        ) : (
          <MailboxForm stored={config.data ?? null} />
        )}
      </CardBody>
    </Card>
  );
};
