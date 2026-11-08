// The portal sign-in code through «الرسائل التلقائية»: it goes to the number ON FILE by whichever
// transport the settings name, SMS in one part, WhatsApp in its own wording — and a delivery that
// failed changes nothing the caller is told (one answer on every path, as before).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const text = vi.hoisted(() => ({ sendTextMessage: vi.fn() }));
const identities = vi.hoisted(() => ({ resolvePortalIdentity: vi.fn() }));

vi.mock('../messaging/text-message', () => text);
vi.mock('./portal-identities', () => identities);

const { authService, portalChallengeSms } = await import('./auth.service');
const { userService } = await import('../users');
const { auditService } = await import('../audit');

const CODE = '483920';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(userService, 'setPortalChallenge').mockResolvedValue(undefined as never);
  vi.spyOn(authService, 'generatePortalCode').mockReturnValue(CODE);
  identities.resolvePortalIdentity.mockResolvedValue({
    _id: 'u-1',
    phone: '01012345678',
    portalChallenge: null,
  });
  vi.spyOn(auditService, 'record').mockResolvedValue(undefined as never);
  text.sendTextMessage.mockResolvedValue({
    ok: true,
    detail: null,
    results: [{ channel: 'sms', ok: true, detail: null }],
  });
});

describe('startPortalChallenge', () => {
  it('sends the code to the number on file — WhatsApp’s wording, and SMS’s one-part wording', async () => {
    const answer = await authService.startPortalChallenge('applicant', '29001011234567', '0100');
    expect(answer.accepted).toBe(true);
    const [phone, message] = text.sendTextMessage.mock.calls[0] as [
      string,
      { whatsapp: string; sms: string },
    ];
    // Not the number the caller typed: the one the account holds.
    expect(phone).toBe('01012345678');
    expect(message.whatsapp).toContain(CODE);
    expect(message.whatsapp).toContain('رمز الدخول إلى بوابة المتقدمين');
    expect(message.sms).toBe(portalChallengeSms(CODE));
  });

  it('answers the same when the delivery failed', async () => {
    const delivered = await authService.startPortalChallenge('applicant', '2900', '0100');
    text.sendTextMessage.mockResolvedValue({
      ok: false,
      detail: 'sms endpoint not configured',
      results: [{ channel: 'sms', ok: false, detail: 'sms endpoint not configured' }],
    });
    const failed = await authService.startPortalChallenge('applicant', '2900', '0100');
    expect(failed).toEqual(delivered);
  });

  it('sends nothing for an identity that matched nobody', async () => {
    identities.resolvePortalIdentity.mockResolvedValue(null);
    await authService.startPortalChallenge('applicant', '2900', '0100');
    expect(text.sendTextMessage).not.toHaveBeenCalled();
  });
});

describe('the SMS wording', () => {
  it('is one Arabic SMS part — a code split across two parts can arrive as two', () => {
    const sms = portalChallengeSms(CODE);
    expect(sms).toContain(CODE);
    expect([...sms].length).toBeLessThanOrEqual(70);
  });
});
