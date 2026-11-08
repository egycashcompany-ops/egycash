// «الرسائل التلقائية» at the schema — the layer that decides what a caller may even send.
//
// The token is write-only, so its rules live here: never empty (an empty box means «keep it» and
// is not sent), never with a space inside, and `null` is the only way to clear it. The template id
// is digits; the test goes to an Egyptian mobile or an international number, and nothing else.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MESSAGE_CHANNEL,
  TestSmsSchema,
  UpdateMessagingSettingsSchema,
  transportsOf,
} from './messaging.js';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.syn-token.c2ln';

describe('UpdateMessagingSettingsSchema', () => {
  it('accepts only what changes', () => {
    expect(UpdateMessagingSettingsSchema.safeParse({}).success).toBe(true);
    expect(UpdateMessagingSettingsSchema.safeParse({ channel: 'both' }).success).toBe(true);
    expect(
      UpdateMessagingSettingsSchema.safeParse({
        sms: { enabled: true, templateId: '12345', token: TOKEN },
      }).success,
    ).toBe(true);
  });

  it('is strict, at both levels', () => {
    expect(UpdateMessagingSettingsSchema.safeParse({ other: 1 }).success).toBe(false);
    expect(UpdateMessagingSettingsSchema.safeParse({ sms: { tokenRef: {} } }).success).toBe(false);
    expect(UpdateMessagingSettingsSchema.safeParse({ channel: 'fax' }).success).toBe(false);
  });

  it('takes a token as one word — never empty, never blanks, never «Bearer …»', () => {
    for (const token of ['', '   ', `Bearer ${TOKEN}`, 'x'.repeat(4097)]) {
      expect(
        UpdateMessagingSettingsSchema.safeParse({ sms: { token } }).success,
        JSON.stringify(token.slice(0, 20)),
      ).toBe(false);
    }
    const trimmed = UpdateMessagingSettingsSchema.parse({ sms: { token: ` ${TOKEN} ` } });
    expect(trimmed.sms?.token).toBe(TOKEN);
  });

  it('clears the token, or the template, on `null` only', () => {
    expect(UpdateMessagingSettingsSchema.parse({ sms: { token: null } }).sms?.token).toBeNull();
    expect(
      UpdateMessagingSettingsSchema.parse({ sms: { templateId: null } }).sms?.templateId,
    ).toBeNull();
  });

  it('takes a template id as digits, at most 20', () => {
    expect(UpdateMessagingSettingsSchema.safeParse({ sms: { templateId: '0012' } }).success).toBe(
      true,
    );
    for (const templateId of ['', 'abc', '12-3', '1'.repeat(21)]) {
      expect(UpdateMessagingSettingsSchema.safeParse({ sms: { templateId } }).success).toBe(false);
    }
  });
});

describe('TestSmsSchema', () => {
  it('accepts an Egyptian mobile or an international number', () => {
    for (const phone of ['01012345678', ' 01512345678 ', '+201012345678', '+971501234567']) {
      expect(TestSmsSchema.safeParse({ phone }).success, phone).toBe(true);
    }
  });

  it('refuses anything else', () => {
    for (const phone of ['', 'abc', '0101234567', '201012345678', '+0123456789']) {
      expect(TestSmsSchema.safeParse({ phone }).success, phone).toBe(false);
    }
    expect(TestSmsSchema.safeParse({ phone: '01012345678', body: 'x' }).success).toBe(false);
  });
});

describe('the channel', () => {
  it('is WhatsApp until somebody chooses — as before the screen existed', () => {
    expect(DEFAULT_MESSAGE_CHANNEL).toBe('whatsapp');
  });

  it('resolves to the transports it sends on, SMS first for both', () => {
    expect(transportsOf('sms')).toEqual(['sms']);
    expect(transportsOf('whatsapp')).toEqual(['whatsapp']);
    expect(transportsOf('both')).toEqual(['sms', 'whatsapp']);
  });
});
