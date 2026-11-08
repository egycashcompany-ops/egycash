// «الرسائل التلقائية» — how the messages the system sends by itself reach a person's mobile.
//
// «عايز أعمل Automation بدل واتساب يبقي SMS ممكن تشرحلى المطلوب ؟ وتجهز السيستم على كدا». Login
// details and setup links, recruitment portal invitations and portal sign-in codes go by SMS
// (Etisalat Egypt), by WhatsApp, or by both. Etisalat's portal gives two values for API use, and
// both are typed here: the TEMPLATE ID (an "API" template whose script is exactly `{Body}`) and
// the TOKEN generated for an "Agent".
//
// The token box is never filled from the server — the server never sends it; `tokenSet` turns its
// hint into «مضبوط منذ …», an empty box keeps what is stored, and «إزالة» clears it on save. The
// whole form is ONE save, and the test acts on what is STORED, so it waits until the form is
// saved: a result for settings still unsaved on screen would answer a question nobody asked.
//
// `setting.view` opens the page (the route); `setting.edit` is what changes anything here — the
// fields, the save and the test — exactly as the API enforces it.
import { useEffect, useState } from 'react';
import {
  MESSAGE_CHANNELS,
  SMS_TEST_MESSAGE,
  type Locale,
  type MessageChannel,
  type MessagingSettingsDto,
  type SmsTestRunDto,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Can, useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { Field, Input, Switch } from '../../../../shared/ui/form';
import { PasswordInput } from '../../../../shared/ui/PasswordInput';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { MissingFieldsBanner, useRequiredFields } from '../../../../shared/ui/required-fields';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatBusinessDateTime } from '../../../../shared/lib/format';
import { cn } from '../../../../shared/lib/cn';
import { useMessagingSettings, useTestSms, useUpdateMessagingSettings } from '../api/messaging-api';
import {
  draftSignature,
  messagingDraftOf,
  messagingPatchBody,
  smsDetailKey,
  templateIdValid,
  testPhoneValid,
  tokenAfterSave,
  tokenValid,
  type MessagingDraft,
} from '../lib/messaging-view';

/** The script Etisalat's API template must have — exactly, letter case included. */
const ETISALAT_TEMPLATE_SCRIPT = '{Body}';

const NOTE =
  'rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200';

/** A reason as a sentence: ours are translated, the provider's own answer is shown as it came. */
const useDetailText = (): ((detail: string | null) => string) => {
  const t = useT();
  return (detail) => {
    const key = smsDetailKey(detail);
    return key === null ? (detail ?? '—') : t(key);
  };
};

/** The last «إرسال رسالة تجريبية»: when, and whether it went or why not. */
const LastTest = ({ run }: { run: SmsTestRunDto | null }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const detailText = useDetailText();
  if (run === null) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400" data-messaging-last-test="none">
        {t('systemAdmin.messaging.test.never')}
      </p>
    );
  }
  return (
    <div className="space-y-1" data-messaging-last-test={run.ok ? 'ok' : 'failed'}>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('systemAdmin.messaging.test.lastAt', { at: formatBusinessDateTime(run.at, locale) })}
      </p>
      <p
        className={cn(
          'text-sm',
          run.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
        )}
      >
        {run.ok
          ? t('systemAdmin.messaging.test.sent')
          : t('systemAdmin.messaging.test.failed', { reason: detailText(run.detail) })}
      </p>
    </div>
  );
};

/** One channel option — a radio with what it means beneath it. */
const ChannelOption = ({
  channel,
  checked,
  disabled,
  onSelect,
}: {
  channel: MessageChannel;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm',
        checked
          ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950'
          : 'border-slate-200 dark:border-slate-700',
        disabled && 'cursor-default',
      )}
      data-messaging-channel={channel}
    >
      <input
        type="radio"
        name="messaging-channel"
        value={channel}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <span className="min-w-0">
        <span className="block font-medium text-slate-800 dark:text-slate-100">
          {t(`systemAdmin.messaging.channels.${channel}`)}
        </span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">
          {t(`systemAdmin.messaging.channelHints.${channel}`)}
        </span>
      </span>
    </label>
  );
};

/** The form, mounted once the GET has answered. */
const MessagingForm = ({ stored }: { stored: MessagingSettingsDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const canEdit = can('setting.edit');
  const save = useUpdateMessagingSettings();
  const test = useTestSms();
  const [draft, setDraft] = useState<MessagingDraft>(() => messagingDraftOf(stored));
  const [phone, setPhone] = useState('');
  const detailText = useDetailText();

  // Follow the server after every save — keyed on content, so a refetch that returns the same
  // values does not throw away an edit in progress (the mailbox card's rule).
  const serverSignature = draftSignature(messagingDraftOf(stored));
  const [followed, setFollowed] = useState(serverSignature);
  useEffect(() => {
    if (followed === serverSignature) return;
    setFollowed(serverSignature);
    setDraft(messagingDraftOf(stored));
  }, [stored, serverSignature, followed]);

  const set = (patch: Partial<MessagingDraft>): void =>
    setDraft((current) => ({ ...current, ...patch }));
  const dirty = draftSignature(draft) !== serverSignature;
  const { sms, whatsapp } = stored;
  const willHaveToken = tokenAfterSave(stored, draft);

  const required = useRequiredFields(
    [
      {
        key: 'templateId',
        label: t('systemAdmin.messaging.sms.templateId'),
        ok:
          templateIdValid(draft.templateId) &&
          (!draft.smsEnabled || draft.templateId.trim() !== ''),
      },
      {
        key: 'token',
        label: t('systemAdmin.messaging.sms.token'),
        ok: tokenValid(draft.token) && (!draft.smsEnabled || willHaveToken),
      },
    ],
    stored,
  );

  const submit = required.guard(async () => {
    try {
      const saved = await save.mutateAsync(messagingPatchBody(stored, draft));
      // Empties the token box: a saved token is never shown again.
      setDraft(messagingDraftOf(saved));
      test.reset();
      toast.success(t('systemAdmin.messaging.saved'));
    } catch {
      // Toasted by the global handler in the reader's language.
    }
  });

  const runTest = async (): Promise<void> => {
    try {
      const run = await test.mutateAsync({ phone: phone.trim() });
      if (run.ok) toast.success(t('systemAdmin.messaging.test.sent'));
      else toast.error(t('systemAdmin.messaging.test.failed', { reason: detailText(run.detail) }));
    } catch {
      // Toasted by the global handler.
    }
  };

  const tokenHint = sms.tokenSet
    ? draft.clearToken
      ? t('systemAdmin.messaging.sms.tokenWillClear')
      : t('systemAdmin.messaging.sms.tokenSetSince', {
          at: formatBusinessDateTime(sms.tokenUpdatedAt, locale),
        })
    : t('systemAdmin.messaging.sms.tokenNotSet');
  const smsUnusable = draft.channel !== 'whatsapp' && !draft.smsEnabled;
  const whatsappUnusable = draft.channel !== 'sms' && !whatsapp.configured;
  const canTest = canEdit && !dirty && testPhoneValid(phone);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t('systemAdmin.messaging.channelTitle')} />
        <CardBody className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('systemAdmin.messaging.whatIsSent')}
          </p>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup">
            {MESSAGE_CHANNELS.map((channel) => (
              <ChannelOption
                key={channel}
                channel={channel}
                checked={draft.channel === channel}
                disabled={!canEdit}
                onSelect={() => set({ channel })}
              />
            ))}
          </div>
          {smsUnusable && (
            <p className={NOTE} data-messaging-warning="sms-off">
              {t('systemAdmin.messaging.smsOffWarning')}
            </p>
          )}
          {whatsappUnusable && (
            <p className={NOTE} data-messaging-warning="whatsapp-off">
              {t('systemAdmin.messaging.whatsappOffWarning')}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('systemAdmin.messaging.sms.title')}
          actions={
            <StatusBadge
              tone={sms.enabled ? 'success' : 'neutral'}
              label={t(
                sms.enabled ? 'systemAdmin.messaging.sms.on' : 'systemAdmin.messaging.sms.off',
              )}
            />
          }
        />
        <CardBody className="space-y-4">
          {!sms.endpointConfigured && (
            <p className={NOTE} data-messaging-endpoint="missing">
              {t('systemAdmin.messaging.sms.endpointMissing')}
            </p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('systemAdmin.messaging.sms.portalHint', { script: ETISALAT_TEMPLATE_SCRIPT })}
          </p>
          <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />

          <Switch
            label={t('systemAdmin.messaging.sms.enabled')}
            description={t('systemAdmin.messaging.sms.enabledHint')}
            checked={draft.smsEnabled}
            disabled={!canEdit}
            onChange={(e) => set({ smsEnabled: e.target.checked })}
            data-messaging-sms-enabled="true"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('systemAdmin.messaging.sms.templateId')}
              htmlFor="messaging-template-id"
              required={draft.smsEnabled}
              missing={required.isMissing('templateId')}
              error={
                templateIdValid(draft.templateId)
                  ? undefined
                  : t('systemAdmin.messaging.sms.templateIdInvalid')
              }
              hint={t('systemAdmin.messaging.sms.templateIdHint')}
            >
              <Input
                id="messaging-template-id"
                value={draft.templateId}
                onChange={(e) => set({ templateId: e.target.value })}
                readOnly={!canEdit}
                inputMode="numeric"
                maxLength={20}
                autoComplete="off"
                dir="ltr"
                data-messaging-template-id="true"
              />
            </Field>
            <Field
              label={t('systemAdmin.messaging.sms.token')}
              htmlFor="messaging-token"
              required={draft.smsEnabled && !willHaveToken}
              missing={required.isMissing('token')}
              error={
                tokenValid(draft.token) ? undefined : t('systemAdmin.messaging.sms.tokenInvalid')
              }
              hint={tokenHint}
            >
              <Can
                permission="setting.edit"
                fallback={
                  <p
                    className="text-sm text-slate-700 dark:text-slate-200"
                    data-messaging-token-state="read-only"
                  >
                    {sms.tokenSet
                      ? t('systemAdmin.messaging.sms.tokenSetShort')
                      : t('systemAdmin.messaging.sms.tokenNotSet')}
                  </p>
                }
              >
                <div className="flex items-center gap-2">
                  <PasswordInput
                    id="messaging-token"
                    value={draft.token}
                    onChange={(e) => set({ token: e.target.value })}
                    maxLength={4096}
                    autoComplete="new-password"
                    placeholder={
                      sms.tokenSet ? t('systemAdmin.messaging.sms.tokenKeepPlaceholder') : undefined
                    }
                    data-messaging-token="true"
                  />
                  {sms.tokenSet && (
                    <Button
                      variant={draft.clearToken ? 'ghost' : 'ghost-danger'}
                      size="sm"
                      data-messaging-action="clear-token"
                      onClick={() => set({ clearToken: !draft.clearToken, token: '' })}
                    >
                      {t(
                        draft.clearToken
                          ? 'systemAdmin.messaging.sms.keepToken'
                          : 'systemAdmin.messaging.sms.clearToken',
                      )}
                    </Button>
                  )}
                </div>
              </Can>
            </Field>
          </div>
        </CardBody>
      </Card>

      <Can permission="setting.edit">
        <div className="flex justify-end">
          <Button
            loading={save.isPending}
            disabled={!dirty}
            data-messaging-action="save"
            onClick={submit}
          >
            {t('systemAdmin.messaging.save')}
          </Button>
        </div>
      </Can>

      <Card>
        <CardHeader title={t('systemAdmin.messaging.test.title')} />
        <CardBody className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('systemAdmin.messaging.test.hint', { text: SMS_TEST_MESSAGE })}
          </p>
          <Can permission="setting.edit">
            <div className="flex flex-wrap items-end gap-3">
              <Field
                label={t('systemAdmin.messaging.test.phone')}
                htmlFor="messaging-test-phone"
                className="min-w-48 flex-1"
                hint={t('systemAdmin.messaging.test.phoneHint')}
              >
                <Input
                  id="messaging-test-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  maxLength={16}
                  autoComplete="off"
                  dir="ltr"
                  data-messaging-test-phone="true"
                />
              </Field>
              <Button
                variant="secondary"
                loading={test.isPending}
                disabled={!canTest}
                data-messaging-action="test"
                onClick={() => void runTest()}
              >
                {t('systemAdmin.messaging.test.send')}
              </Button>
            </div>
            {dirty && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('systemAdmin.messaging.test.saveFirst')}
              </p>
            )}
          </Can>
          <LastTest run={sms.lastTest} />
        </CardBody>
      </Card>
    </div>
  );
};

export const MessagingSettingsPage = (): JSX.Element => {
  const t = useT();
  const settings = useMessagingSettings();
  return (
    <PageContainer>
      <PageHeader title={t('systemAdmin.messaging.title')} />
      {settings.isLoading ? (
        <LoadingState label={t('common.loading')} />
      ) : settings.isError || settings.data === undefined ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <MessagingForm stored={settings.data} />
      )}
    </PageContainer>
  );
};
