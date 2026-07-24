// Localized label for a leave-type CODE: seeded codes have i18n keys; admin-created custom
// types fall back to their code (the t() helper returns the key itself when unknown).
export const typeLabel = (t: (key: string) => string, code: string): string => {
  const translated = t(`leave.type.${code}`);
  return translated === `leave.type.${code}` ? code : translated;
};
