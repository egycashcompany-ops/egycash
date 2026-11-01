// Which accounts may hold and use a passkey (ADR-035 §3).
//
// Every account of this company may. An EXTERNAL account may only when the module that owns it
// says so, from its own seed — the same shape as `registerExternalSurface`, so the platform never
// names a module. Deny by default: the applicant portal never registers, because its sign-in is the
// national ID, the phone on file and a one-time code, and a passkey would replace that check rather
// than add to it. The gold-vault portal registers its customers («الموظفين وعملاء بوابة الذهب»).

const allowed = new Set<string>();

const keyOf = (moduleId: string, subjectType: string): string => `${moduleId}\u0000${subjectType}`;

export const allowPasskeysFor = (moduleId: string, subjectType: string): void => {
  allowed.add(keyOf(moduleId, subjectType));
};

export const mayUsePasskeys = (
  external: { moduleId: string; subjectType: string } | null,
): boolean => external === null || allowed.has(keyOf(external.moduleId, external.subjectType));
