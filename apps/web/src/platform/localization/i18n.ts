// Minimal namespaced catalog for the phase 2.1 shell. Grows into per-module
// catalogs served by the localization service in phase 2.2.
import { type Locale } from '@ecms/contracts';

const catalogs: Record<Locale, Record<string, string>> = {
  en: {
    'platform.auth.login.title': 'Sign in to ECMS',
    'platform.auth.login.email': 'Email',
    'platform.auth.login.password': 'Password',
    'platform.auth.login.submit': 'Sign in',
    'platform.auth.login.totpCode': 'Authentication code',
    'platform.auth.login.totpSubmit': 'Verify',
    'platform.auth.login.enrollHint':
      'Your account requires two-factor authentication. Scan the secret in your authenticator app, then enter the code.',
    'platform.auth.login.failed': 'Sign-in failed',
    'platform.shell.signOut': 'Sign out',
    'platform.shell.home.permissions': 'Your permissions',
    'platform.shell.home.scope': 'Scope',
    'platform.shell.home.welcome': 'Welcome',
    'platform.shell.language': 'العربية',
  },
  ar: {
    'platform.auth.login.title': 'تسجيل الدخول إلى ECMS',
    'platform.auth.login.email': 'البريد الإلكتروني',
    'platform.auth.login.password': 'كلمة المرور',
    'platform.auth.login.submit': 'دخول',
    'platform.auth.login.totpCode': 'رمز التحقق',
    'platform.auth.login.totpSubmit': 'تحقق',
    'platform.auth.login.enrollHint':
      'حسابك يتطلب مصادقة ثنائية. امسح الرمز السري في تطبيق المصادقة ثم أدخل الرمز.',
    'platform.auth.login.failed': 'فشل تسجيل الدخول',
    'platform.shell.signOut': 'تسجيل الخروج',
    'platform.shell.home.permissions': 'صلاحياتك',
    'platform.shell.home.scope': 'النطاق',
    'platform.shell.home.welcome': 'مرحباً',
    'platform.shell.language': 'English',
  },
};

export const translate = (locale: Locale, key: string): string => catalogs[locale][key] ?? key;
