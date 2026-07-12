// In-memory bilingual catalog for the recruitment frontend foundation. `translate` interpolates
// `{{name}}` placeholders and falls back to the key. This grows into per-module catalogs served
// by the localization service in a later phase; the call sites (useT) stay unchanged.
import { type Locale } from '@ecms/contracts';

const en: Record<string, string> = {
  // Auth / shell (platform)
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
  'platform.shell.language': 'العربية',

  // Common UI kit
  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.close': 'Close',
  'common.menu': 'Menu',
  'common.search': 'Search',
  'common.clear': 'Clear',
  'common.remove': 'Remove',
  'common.backHome': 'Back to overview',
  'common.empty.title': 'Nothing here yet',
  'common.error.title': 'Could not load',
  'common.errorBoundary.title': 'Something went wrong',
  'common.errorBoundary.body': 'An unexpected error occurred while rendering this screen.',
  'common.errorBoundary.reload': 'Reload',
  'common.forbidden.title': 'Access denied',
  'common.forbidden.body': 'You do not have permission to view this page.',
  'common.notFound.title': 'Page not found',
  'common.notFound.body': 'The page you are looking for does not exist.',
  'common.theme.light': 'Light theme',
  'common.theme.dark': 'Dark theme',
  'common.theme.system': 'System theme',
  'common.pagination.showing': 'Showing {{from}}–{{to}} of {{total}}',
  'common.pagination.perPage': 'Per page',
  'common.pagination.prev': 'Previous',
  'common.pagination.next': 'Next',
  'common.pagination.page': 'Page {{page}} of {{total}}',
  'common.filters.clear': 'Clear filters',
  'common.bulk.selected': '{{count}} selected',
  'common.bulk.clear': 'Clear',
  'common.upload.prompt': 'Drag a file here or click to browse',
  'common.upload.max': 'Up to {{size}} MB',
  'common.upload.tooLarge': '{{name}} exceeds the {{size}} MB limit',

  // Notifications (bell)
  'notifications.title': 'Notifications',
  'notifications.empty': 'You have no notifications',

  // Recruitment module
  'recruitment.title': 'Recruitment',
  'recruitment.nav.overview': 'Overview',
  'recruitment.nav.pipeline': 'Pipeline',
  'recruitment.nav.hiring': 'Hiring',
  'recruitment.nav.applicants': 'Applicants',
  'recruitment.nav.screening': 'Screening',
  'recruitment.nav.interviews': 'Interviews',
  'recruitment.nav.offers': 'Job Offers',
  'recruitment.nav.employees': 'Employees',
  'recruitment.nav.hiringDocuments': 'Hiring Documents',
  'recruitment.nav.employeeFiles': 'Employee Files',
  'recruitment.placeholder.subtitle': 'This screen arrives in a later sprint.',
  'recruitment.placeholder.title': 'Screen not built yet',
  'recruitment.placeholder.body': 'The foundation is ready; the screen for this stage will be added next.',
  'recruitment.overview.title': 'Recruitment',
  'recruitment.overview.subtitle': 'Manage the hiring pipeline end to end.',
  'recruitment.overview.welcome': 'Welcome, {{name}} — manage the hiring pipeline end to end.',
  'recruitment.overview.noAccessTitle': 'No recruitment access',
  'recruitment.overview.noAccessBody': 'Ask an administrator to grant you recruitment permissions.',
  'recruitment.cards.applicants': 'Register and track candidates through the pipeline.',
  'recruitment.cards.screening': 'Run the initial screening decision for each applicant.',
  'recruitment.cards.interviews': 'Schedule rounds and panels, and record evaluations.',
  'recruitment.cards.offers': 'Draft, send, and track job offers.',
  'recruitment.cards.employees': 'Convert accepted offers into employee records.',
  'recruitment.cards.hiringDocuments': 'Collect and validate required hiring documents.',
  'recruitment.cards.employeeFiles': 'Assemble the electronic employee file.',
};

const ar: Record<string, string> = {
  // Auth / shell (platform)
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
  'platform.shell.language': 'English',

  // Common UI kit
  'common.loading': 'جارٍ التحميل…',
  'common.retry': 'إعادة المحاولة',
  'common.close': 'إغلاق',
  'common.menu': 'القائمة',
  'common.search': 'بحث',
  'common.clear': 'مسح',
  'common.remove': 'إزالة',
  'common.backHome': 'العودة إلى النظرة العامة',
  'common.empty.title': 'لا يوجد شيء هنا بعد',
  'common.error.title': 'تعذّر التحميل',
  'common.errorBoundary.title': 'حدث خطأ ما',
  'common.errorBoundary.body': 'حدث خطأ غير متوقع أثناء عرض هذه الشاشة.',
  'common.errorBoundary.reload': 'إعادة التحميل',
  'common.forbidden.title': 'تم رفض الوصول',
  'common.forbidden.body': 'ليس لديك صلاحية لعرض هذه الصفحة.',
  'common.notFound.title': 'الصفحة غير موجودة',
  'common.notFound.body': 'الصفحة التي تبحث عنها غير موجودة.',
  'common.theme.light': 'السمة الفاتحة',
  'common.theme.dark': 'السمة الداكنة',
  'common.theme.system': 'سمة النظام',
  'common.pagination.showing': 'عرض {{from}}–{{to}} من {{total}}',
  'common.pagination.perPage': 'لكل صفحة',
  'common.pagination.prev': 'السابق',
  'common.pagination.next': 'التالي',
  'common.pagination.page': 'صفحة {{page}} من {{total}}',
  'common.filters.clear': 'مسح عوامل التصفية',
  'common.bulk.selected': 'تم تحديد {{count}}',
  'common.bulk.clear': 'مسح',
  'common.upload.prompt': 'اسحب ملفًا هنا أو انقر للاختيار',
  'common.upload.max': 'حتى {{size}} ميجابايت',
  'common.upload.tooLarge': '{{name}} يتجاوز حد {{size}} ميجابايت',

  // Notifications (bell)
  'notifications.title': 'الإشعارات',
  'notifications.empty': 'لا توجد لديك إشعارات',

  // Recruitment module
  'recruitment.title': 'التوظيف',
  'recruitment.nav.overview': 'نظرة عامة',
  'recruitment.nav.pipeline': 'المسار',
  'recruitment.nav.hiring': 'التعيين',
  'recruitment.nav.applicants': 'المتقدِّمون',
  'recruitment.nav.screening': 'الفرز المبدئي',
  'recruitment.nav.interviews': 'المقابلات',
  'recruitment.nav.offers': 'عروض العمل',
  'recruitment.nav.employees': 'الموظفون',
  'recruitment.nav.hiringDocuments': 'مستندات التعيين',
  'recruitment.nav.employeeFiles': 'ملفات الموظفين',
  'recruitment.placeholder.subtitle': 'ستتوفر هذه الشاشة في مرحلة لاحقة.',
  'recruitment.placeholder.title': 'لم يتم بناء الشاشة بعد',
  'recruitment.placeholder.body': 'الأساس جاهز؛ ستُضاف شاشة هذه المرحلة لاحقًا.',
  'recruitment.overview.title': 'التوظيف',
  'recruitment.overview.subtitle': 'أدر مسار التعيين من البداية إلى النهاية.',
  'recruitment.overview.welcome': 'مرحبًا {{name}} — أدر مسار التعيين من البداية إلى النهاية.',
  'recruitment.overview.noAccessTitle': 'لا صلاحية للتوظيف',
  'recruitment.overview.noAccessBody': 'اطلب من المسؤول منحك صلاحيات التوظيف.',
  'recruitment.cards.applicants': 'تسجيل المتقدِّمين ومتابعتهم عبر المسار.',
  'recruitment.cards.screening': 'اتخاذ قرار الفرز المبدئي لكل متقدِّم.',
  'recruitment.cards.interviews': 'جدولة الجولات واللجان وتسجيل التقييمات.',
  'recruitment.cards.offers': 'إعداد عروض العمل وإرسالها ومتابعتها.',
  'recruitment.cards.employees': 'تحويل العروض المقبولة إلى سجلات موظفين.',
  'recruitment.cards.hiringDocuments': 'جمع مستندات التعيين المطلوبة والتحقق منها.',
  'recruitment.cards.employeeFiles': 'تجميع الملف الإلكتروني للموظف.',
};

const catalogs: Record<Locale, Record<string, string>> = { en, ar };

/** Look up a key and interpolate `{{name}}` placeholders from `params`. Falls back to the key. */
export const translate = (
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string => {
  const template = catalogs[locale][key] ?? key;
  if (params === undefined) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_full: string, name: string) => {
    const value = params[name];
    return value === undefined ? `{{${name}}}` : String(value);
  });
};
