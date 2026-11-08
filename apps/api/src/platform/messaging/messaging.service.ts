// /platform/messaging — «الرسائل التلقائية» on /system/messaging: the channel the automatic text
// messages take, the Etisalat SMS settings, and the test button.
//
// `setting.view` reads, `setting.edit` writes — at the route, and at ORGANIZATION scope for a
// write here: the messages are sent for the whole company, so a branch-scoped holder editing them
// would be editing them for everybody (the ATM mailbox's rule, atm/shared/settings-authority.ts).
//
// The token only ever travels TOWARD the server: a given one is SEALED through the platform
// secret store before anything is written, an omitted one keeps the stored ref, `null` clears it,
// and no answer, log line or audit row carries it — the DTO says `tokenSet`, the audit says that it
// was replaced or cleared.
import {
  SMS_TEST_MESSAGE,
  type EntityRef,
  type MessagingSettingsDto,
  type SecretRef,
  type SmsTestResultDto,
  type SmsTestRunDto,
  type UpdateMessagingSettings,
} from '@ecms/contracts';
import { smsEndpointConfigured } from '../../infrastructure/messaging/sms';
import { whatsappConfigured } from '../../infrastructure/messaging/whatsapp';
import { BusinessRuleError, ForbiddenError, ValidationError } from '../../shared/errors';
import { scopeOf, type AuthContext } from '../../shared/types';
import { diffChanges } from '../../shared/utils/diff';
import { auditService } from '../audit';
import { getSecretStore } from '../secrets';
import { type MessagingConfigDoc, type SmsTestRunRecord } from './messaging-config.model';
import { messagingConfigRepository } from './messaging-config.repository';
import {
  invalidateMessagingConfig,
  messagingConfigViewOf,
  smsTokenContext,
  type MessagingConfigView,
} from './messaging-config.store';
import { sendSmsWith } from './sms-sender';

/** The audit entity — a LITERAL pair, so the realtime registry spec can find it. */
const messagingRef = (id: string): EntityRef => ({
  moduleId: 'platform',
  entityType: 'messagingConfig',
  entityId: id,
});

const REDACTED = '[redacted]';

/** Everything the audit may show — the token is not in it, sealed or plain. */
const snapshot = (view: MessagingConfigView): Record<string, unknown> => ({
  channel: view.channel,
  'sms.enabled': view.sms.enabled,
  'sms.templateId': view.sms.templateId,
});

const runDto = (run: SmsTestRunRecord | null): SmsTestRunDto | null =>
  run === null ? null : { at: run.at.toISOString(), ok: run.ok, detail: run.detail };

/** Pure: what the screen reads. The token's ref never leaves this function. */
export const toMessagingSettingsDto = (view: MessagingConfigView): MessagingSettingsDto => ({
  channel: view.channel,
  sms: {
    enabled: view.sms.enabled,
    provider: view.sms.provider,
    templateId: view.sms.templateId,
    tokenSet: view.sms.tokenRef !== null,
    tokenUpdatedAt: view.sms.tokenUpdatedAt?.toISOString() ?? null,
    endpointConfigured: smsEndpointConfigured(),
    lastTest: runDto(view.sms.lastTest),
  },
  whatsapp: { configured: whatsappConfigured() },
});

/** 403 unless the caller holds `setting.edit` company-wide. */
const assertCompanyWideEditor = (ctx: AuthContext): void => {
  if (scopeOf(ctx, 'setting.edit') !== 'organization') {
    throw new ForbiddenError(
      'setting.edit must be held at organization scope — the automatic messages are company-wide',
    );
  }
};

/**
 * Switched on with no template or no token, every SMS could only fail — refused, naming the box
 * that is empty. Judged on the state the save would LEAVE, so one save may fill both and switch on.
 */
const assertSendable = (before: MessagingConfigView, input: UpdateMessagingSettings): void => {
  const sms = input.sms ?? {};
  const enabled = sms.enabled ?? before.sms.enabled;
  if (!enabled) return;
  const templateId = sms.templateId === undefined ? before.sms.templateId : sms.templateId;
  const hasToken = sms.token === undefined ? before.sms.tokenRef !== null : sms.token !== null;
  const missing = [
    ...(templateId === null
      ? [{ field: 'body.sms.templateId', message: 'a template id is required to switch SMS on' }]
      : []),
    ...(hasToken
      ? []
      : [{ field: 'body.sms.token', message: 'a token is required to switch SMS on' }]),
  ];
  if (missing.length > 0) {
    throw new ValidationError(missing.map((row) => ({ ...row, code: 'REQUIRED' })));
  }
};

class MessagingService {
  /** GET — the settings without the token; the defaults while nothing is saved. */
  async getSettings(): Promise<MessagingSettingsDto> {
    return toMessagingSettingsDto(
      messagingConfigViewOf(await messagingConfigRepository.findSingleton()),
    );
  }

  /** PATCH — only what is sent changes; the first save creates the document. */
  async updateSettings(
    input: UpdateMessagingSettings,
    ctx: AuthContext,
  ): Promise<MessagingSettingsDto> {
    assertCompanyWideEditor(ctx);
    const before = await messagingConfigRepository.findSingleton();
    const beforeView = messagingConfigViewOf(before);
    assertSendable(beforeView, input);
    const token = input.sms?.token;
    // Refused BEFORE anything is written, rather than storing a token in the clear.
    if (typeof token === 'string' && !getSecretStore().available()) {
      throw new BusinessRuleError(
        'the SMS token cannot be stored: the secret store has no usable key on this deployment',
      );
    }

    // The document exists before the token is sealed, so the sealing context can name it.
    const { doc, created } = await messagingConfigRepository.ensureSingleton(ctx.userId);
    const id = String(doc._id);
    const set: Record<string, unknown> = {};
    if (input.channel !== undefined) set.channel = input.channel;
    if (input.sms?.enabled !== undefined) set['sms.enabled'] = input.sms.enabled;
    if (input.sms?.templateId !== undefined) set['sms.templateId'] = input.sms.templateId;

    const hadToken = (doc.sms.tokenRef ?? null) !== null;
    let tokenChange: 'replaced' | 'cleared' | null = null;
    if (typeof token === 'string') {
      set['sms.tokenRef'] = await this.seal(token, id);
      set['sms.tokenUpdatedAt'] = new Date();
      tokenChange = 'replaced';
    } else if (token === null && hadToken) {
      set['sms.tokenRef'] = null;
      set['sms.tokenUpdatedAt'] = null;
      tokenChange = 'cleared';
    }

    const saved: MessagingConfigDoc =
      Object.keys(set).length === 0
        ? doc
        : await messagingConfigRepository.updateById(id, set, {
            by: ctx.userId,
            version: doc.__v,
          });
    invalidateMessagingConfig();

    const savedView = messagingConfigViewOf(saved);
    const changes = diffChanges(created ? {} : snapshot(beforeView), snapshot(savedView));
    if (tokenChange !== null) {
      changes.push({ field: 'sms.token', old: hadToken ? REDACTED : null, new: tokenChange });
    }
    if (created || changes.length > 0) {
      await auditService.record({
        entityRef: messagingRef(id),
        action: created ? 'create' : 'update',
        changes,
      });
    }
    return toMessagingSettingsDto(savedView);
  }

  /**
   * POST /sms/test — «رسالة تجريبية من نظام ECMS.» to the number given, with the STORED settings,
   * even while SMS is switched off: testing before switching on is the point. The run is kept as
   * the screen's last-test line and audited as an outcome; the number is not kept.
   */
  async testSms(phone: string, ctx: AuthContext): Promise<SmsTestResultDto> {
    assertCompanyWideEditor(ctx);
    const { doc } = await messagingConfigRepository.ensureSingleton(ctx.userId);
    const sent = await sendSmsWith(messagingConfigViewOf(doc), phone, SMS_TEST_MESSAGE, {
      evenIfDisabled: true,
    });
    const run: SmsTestRunRecord = { at: new Date(), ok: sent.ok, detail: sent.detail };
    await messagingConfigRepository.recordLastTest(doc._id, run);
    invalidateMessagingConfig();
    await auditService.record({
      entityRef: messagingRef(String(doc._id)),
      action: 'update',
      changes: [
        { field: 'sms.test', old: null, new: sent.ok ? 'sent' : (sent.detail ?? 'failed') },
      ],
    });
    return { at: run.at.toISOString(), ok: run.ok, detail: run.detail };
  }

  /** Refuses rather than storing a token in the clear (the mailbox's `seal`). */
  private async seal(plaintext: string, id: string): Promise<SecretRef> {
    const store = getSecretStore();
    if (!store.available()) {
      throw new BusinessRuleError(
        'the SMS token cannot be stored: the secret store has no usable key on this deployment',
      );
    }
    return store.seal(plaintext, smsTokenContext(id));
  }
}

export const messagingService = new MessagingService();
