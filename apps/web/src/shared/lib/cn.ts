// Tiny class-name combiner (no external dependency): drops falsy values and joins.
// Keeps the shared UI kit self-contained. Tailwind conflict-resolution (tailwind-merge)
// is intentionally out of scope for the foundation — callers order classes deliberately.
export type ClassValue = string | number | false | null | undefined;

export const cn = (...values: ClassValue[]): string =>
  values
    .filter((v): v is string | number => v !== false && v !== null && v !== undefined && v !== '')
    .join(' ');
