// A department or section filter remembered from before its department was LINKED to the company
// list — rewritten to the key the same department answers to now (`healGroupKeys`).
//
// The HR lists and System Users remember a chosen department by its group key, in the address bar
// and in the browser (`useRememberedFilters`). An unlinked department's key is its name; linking
// (`migrate:org-catalog`) gives it `catalog:<id>`, and the saved key would then match nothing — the
// list showing everyone, or nobody, with a raw `name:…` chip. Once the choices have loaded this
// replaces such a key in the address bar (replace, not push: it is the same filter), and the
// remembered value follows on its own.
import { useEffect } from 'react';
import { type SetURLSearchParams } from 'react-router-dom';
import { healGroupKeys, type OrgUnitGroupChoice } from '@ecms/contracts';

export interface GroupParam {
  /** The search param holding the keys, e.g. `dept`. */
  param: string;
  /**
   * EVERY choice of this kind, not the ones narrowed to the current branch: a key that is only out
   * of reach of the branch picked is not stale. Empty while loading — nothing is touched then.
   */
  choices: readonly OrgUnitGroupChoice[];
  read: (raw: string) => string[];
  write: (keys: readonly string[]) => string | null;
}

export const useHealedGroupKeys = (
  [sp, setSp]: [URLSearchParams, SetURLSearchParams],
  params: readonly GroupParam[],
): void => {
  const raw = params.map((p) => sp.get(p.param) ?? '').join('\u0000');
  const loaded = params.map((p) => p.choices.length).join(',');
  useEffect(() => {
    let next: URLSearchParams | null = null;
    for (const p of params) {
      const healed = healGroupKeys(p.read(sp.get(p.param) ?? ''), p.choices);
      if (healed === null) continue;
      next ??= new URLSearchParams(sp);
      const value = p.write(healed);
      if (value === null || value === '') next.delete(p.param);
      else next.set(p.param, value);
    }
    if (next !== null) setSp(next, { replace: true });
    // Re-run when the saved keys or the loaded choices change — not on every render.
  }, [raw, loaded]);
};
