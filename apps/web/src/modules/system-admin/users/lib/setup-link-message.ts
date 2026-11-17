// The message an administrator sends with a setup link — the owner's wording, filled in per person:
//
//   «السيد / محمد مصطفى محمد احمد
//    هذا الرابط خاص بتفعيل حسابكم كود 0101469 …
//    واسم المستخدم هو كود الموظف 0101469»
//
// In Arabic whatever the screen's language: it is written to the person receiving it. The sign-in
// name is the account's own username, which for an employee IS the employee code (the login is
// issued as the code, and follows it when the code changes). An account that signs in by email
// only has no code to quote, so those two lines name the email instead.

export interface SetupLinkMessageInput {
  /** The account's Arabic name, first and last, as the setup dialog names the person. */
  name: string;
  /** The account's sign-in name — the employee code for an employee. */
  username: string | null;
  email: string | null;
  /** The setup link itself, `{origin}{basePath}/activate?token=…`. */
  url: string;
}

/**
 * Where the person signs in afterwards: the link's host, and the path the app is served under,
 * without the scheme — `ecms.egycash.com.eg`, as the owner writes it.
 */
export const signInAddressOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    const base = parsed.pathname.replace(/\/activate\/?$/u, '').replace(/\/+$/u, '');
    return `${parsed.host}${base}`;
  } catch {
    return url;
  }
};

export const setupLinkMessage = ({ name, username, email, url }: SetupLinkMessageInput): string => {
  const code = username === null || username.trim() === '' ? null : username.trim();
  const signInName = code ?? email ?? '';
  return [
    `السيد / ${name.trim()}`,
    code === null ? 'هذا الرابط خاص بتفعيل حسابكم' : `هذا الرابط خاص بتفعيل حسابكم كود ${code}`,
    'وعمل كلمة مرور خاصة بكم لمرة واحدة فقط',
    url,
    'وهو خاص بك فقط، ويرجى عدم إرساله لأي شخص.',
    `يرجى العلم أن الدخول فيما بعد سيكون من خلال هذا الرابط : ${signInAddressOf(url)}`,
    code === null ? `واسم المستخدم هو ${signInName}` : `واسم المستخدم هو كود الموظف ${code}`,
  ].join('\n');
};
