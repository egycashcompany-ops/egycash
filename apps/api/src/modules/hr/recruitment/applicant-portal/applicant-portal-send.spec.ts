// The portal invitation through «الرسائل التلقائية»: it goes to the number on file by whichever
// transport the settings name, WhatsApp keeps its wording and SMS gets a short one carrying the
// link and how to sign in, and the outcome is audited exactly as before — delivered or failed.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const messaging = vi.hoisted(() => ({ sendTextMessage: vi.fn() }));
const audit = vi.hoisted(() => ({ record: vi.fn() }));
const applicants = vi.hoisted(() => ({ getById: vi.fn() }));

vi.mock('../../../../platform/messaging', () => messaging);
vi.mock('../../../../platform/audit', () => ({ auditService: audit }));
vi.mock('../../../../platform/rbac', () => ({ rbacService: {} }));
vi.mock('../../../../platform/users', () => ({ userService: {} }));
vi.mock('../applicants/applicant.repository', () => ({ applicantRepository: applicants }));
vi.mock('../workflow', () => ({ currentStageKind: vi.fn() }));

const { applicantPortalService, inviteSmsText, portalSignInUrl } =
  await import('./applicant-portal.service');

const APPLICANT = '66a1b2c3d4e5f60718293a4b';

/** Parts an Arabic SMS takes: UCS-2 — 70 characters alone, 67 a part once split. */
const ucs2Parts = (body: string): number => {
  const length = [...body].length;
  return length <= 70 ? 1 : Math.ceil(length / 67);
};

beforeEach(() => {
  vi.clearAllMocks();
  applicants.getById.mockResolvedValue({
    _id: APPLICANT,
    fullNameAr: 'محمد أحمد عبد الرحمن',
    contact: { primaryPhone: '01012345678' },
  });
  messaging.sendTextMessage.mockResolvedValue({
    ok: true,
    detail: null,
    results: [{ channel: 'sms', ok: true, detail: null }],
  });
  audit.record.mockResolvedValue(undefined);
});

describe('sendPortalLink', () => {
  it('sends to the number on file, WhatsApp’s wording and the short SMS one', async () => {
    expect(await applicantPortalService.sendPortalLink(APPLICANT, 'u1')).toEqual({
      ok: true,
      detail: null,
    });
    const [phone, message] = messaging.sendTextMessage.mock.calls[0] as [
      string,
      { whatsapp: string; sms: string },
    ];
    expect(phone).toBe('01012345678');
    expect(message.whatsapp).toContain('محمد أحمد عبد الرحمن');
    expect(message.whatsapp).toContain(portalSignInUrl());
    expect(message.sms).toBe(inviteSmsText());
  });

  it('audits the outcome as before — delivered, failed, and by whom', async () => {
    await applicantPortalService.sendPortalLink(APPLICANT, 'u1');
    messaging.sendTextMessage.mockResolvedValue({
      ok: false,
      detail: 'sms endpoint not configured',
      results: [{ channel: 'sms', ok: false, detail: 'sms endpoint not configured' }],
    });
    expect(await applicantPortalService.sendPortalLink(APPLICANT, 'system')).toEqual({
      ok: false,
      detail: 'sms endpoint not configured',
    });
    const changes = audit.record.mock.calls.map(
      (call) => (call[0] as { changes: unknown[] }).changes,
    );
    expect(changes).toEqual([
      [
        { field: 'portalLinkSent', old: null, new: 'delivered' },
        { field: 'by', old: null, new: 'u1' },
      ],
      [
        { field: 'portalLinkSent', old: null, new: 'failed' },
        { field: 'by', old: null, new: 'system' },
      ],
    ]);
  });

  it('sends nothing to an applicant with no phone on file', async () => {
    applicants.getById.mockResolvedValue({ _id: APPLICANT, fullNameAr: 'x', contact: null });
    expect(await applicantPortalService.sendPortalLink(APPLICANT, 'u1')).toEqual({
      ok: false,
      detail: 'no phone number on file',
    });
    expect(messaging.sendTextMessage).not.toHaveBeenCalled();
  });
});

describe('the SMS wording', () => {
  it('carries the link and how to sign in, in fewer parts than the WhatsApp wording', async () => {
    const sms = inviteSmsText();
    expect(sms).toContain(portalSignInUrl());
    expect(sms).toContain('بالرقم القومي ورقم الموبايل');
    await applicantPortalService.sendPortalLink(APPLICANT, 'u1');
    const [, message] = messaging.sendTextMessage.mock.calls[0] as [
      string,
      { whatsapp: string; sms: string },
    ];
    expect(ucs2Parts(sms)).toBeLessThan(ucs2Parts(message.whatsapp));
    expect(ucs2Parts(sms)).toBeLessThanOrEqual(2);
  });
});
