// The owner's message, filled in for one person — «وطبعاً الكود والأسم والرابط هيتغيروا على حسب الشخص».
import { describe, expect, it } from 'vitest';
import { setupLinkMessage, signInAddressOf } from './setup-link-message';

const URL_ = 'https://ecms.egycash.com.eg/activate?token=F00000000';

describe('setupLinkMessage', () => {
  it('is the owner’s message, line for line, for an employee', () => {
    expect(
      setupLinkMessage({
        name: 'محمد مصطفى محمد احمد',
        username: '0101469',
        email: null,
        url: URL_,
        isEmployee: true,
      }),
    ).toBe(
      [
        'السيد / محمد مصطفى محمد احمد',
        'هذا الرابط خاص بتفعيل حسابكم كود 0101469',
        'وعمل كلمة مرور خاصة بكم لمرة واحدة فقط',
        'https://ecms.egycash.com.eg/activate?token=F00000000',
        'وهو خاص بك فقط، ويرجى عدم إرساله لأي شخص.',
        'يرجى العلم أن الدخول فيما بعد سيكون من خلال هذا الرابط : ecms.egycash.com.eg',
        'واسم المستخدم هو كود الموظف 0101469',
      ].join('\n'),
    );
  });

  it('changes the name, the code and the link with the person', () => {
    const message = setupLinkMessage({
      name: '  سارة أحمد ',
      username: '0207001',
      email: 'sara@ecms.local',
      url: 'https://ecms.egycash.com.eg/activate?token=XYZ',
      isEmployee: true,
    });
    expect(message).toContain('السيد / سارة أحمد\n');
    expect(message).toContain('كود 0207001');
    expect(message).toContain('activate?token=XYZ');
    expect(message).not.toContain('0101469');
    expect(message).not.toContain('sara@ecms.local');
  });

  it('names the email when the account has no sign-in name', () => {
    const message = setupLinkMessage({
      name: 'مدير النظام',
      username: null,
      email: 'admin@ecms.local',
      url: URL_,
      isEmployee: false,
    });
    expect(message).toContain('هذا الرابط خاص بتفعيل حسابكم\n');
    expect(message).toContain('واسم المستخدم هو admin@ecms.local');
    expect(message).not.toContain('كود');
  });

  // A system account may have a username; it is not an employee code and is not called one.
  it('names a non-employee’s username without calling it a code', () => {
    const message = setupLinkMessage({
      name: 'مراجع النظام',
      username: 'auditor',
      email: null,
      url: URL_,
      isEmployee: false,
    });
    expect(message).toContain('هذا الرابط خاص بتفعيل حسابكم\n');
    expect(message).toContain('واسم المستخدم هو auditor');
    expect(message).not.toContain('كود');
  });
});

describe('signInAddressOf', () => {
  it('is the host, without the scheme', () => {
    expect(signInAddressOf(URL_)).toBe('ecms.egycash.com.eg');
  });

  it('keeps the path the app is served under', () => {
    expect(signInAddressOf('https://example.com/ecms/activate?token=a')).toBe('example.com/ecms');
  });

  it('keeps a port', () => {
    expect(signInAddressOf('http://localhost:5173/activate?token=a')).toBe('localhost:5173');
  });
});
