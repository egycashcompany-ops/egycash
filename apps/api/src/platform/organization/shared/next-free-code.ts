// The next free sequential code under a prefix: «DEP-0007» after «DEP-0006». Moved here from the
// workforce importer (P-ORG-3 §5.4) because the org chart mints section codes by the same rule, and
// two rules for one sequence is how two writers come to collide.
//
// It reads only codes of its own SHAPE (`<prefix>-<digits>`); anything else — «BR-CAI-1», «DEMO» — is
// ignored, so an imported or hand-typed code can never push the sequence anywhere strange.
export const nextFreeCode = (prefix: string, existing: readonly string[]): string => {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'u');
  const highest = existing.reduce((max, code) => {
    const m = pattern.exec(code);
    return m === null ? max : Math.max(max, Number(m[1]));
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(4, '0')}`;
};

/** Several codes in a row, each reserved before the next is drawn — one request never repeats one. */
export const nextFreeCodes = (prefix: string, existing: readonly string[], count: number): string[] => {
  const taken = [...existing];
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = nextFreeCode(prefix, taken);
    taken.push(code);
    out.push(code);
  }
  return out;
};
