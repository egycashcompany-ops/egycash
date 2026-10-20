// Types for the formal-Arabic guard, so the web spec that runs it typechecks with the rest.
// The script itself is plain ESM, like every other check under `scripts/`.

/** One Arabic string literal in the product's own prose, and where it is written. */
export interface ArabicString {
  /** Repo-relative path. */
  file: string;
  /** 1-based line. */
  line: number;
  /** The literal's contents, without its quotes. */
  text: string;
}

/** Every tell in one string, each as `«form» → what to write instead`. Empty when it is formal. */
export function offendersIn(text: string): string[];

/** Every Arabic string literal the product shows, across web, api and contracts. */
export function productStrings(): ArabicString[];

/** The strings that are not written in formal Arabic, with the tells found in each. */
export function findOffenders(): (ArabicString & { found: string[] })[];

/**
 * The owner's printed papers, reproduced word for word and therefore not scanned: repo-relative
 * paths of the papers' wording and of their default signature names.
 */
export const VERBATIM_PAPERS: readonly string[];

/** Absolute path of the repository root the scan walks. */
export const ROOT: string;
