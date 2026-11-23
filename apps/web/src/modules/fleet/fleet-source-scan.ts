// Reading «الحركة»'s own source, for the specs that hold a rule over the whole module — the Latin
// figures guard (`fleet-latin-figures.spec.ts`) and the image viewers' spec
// (`image-zoom-preview.spec.tsx`). One reader, so the two cannot disagree about what a file or a
// tag is. Not a spec itself (no `.spec`), like `roster-spec-sources.ts`.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `apps/web/src/modules/fleet`. */
export const FLEET_DIR = dirname(fileURLToPath(import.meta.url));

/** Every non-spec .ts/.tsx under `dir` (the module by default), `/`-separated, relative to it. */
export const fleetSources = (dir: string = FLEET_DIR, root: string = dir): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return fleetSources(path, root);
    return /\.tsx?$/u.test(name) && !/\.spec\.tsx?$/u.test(name)
      ? [relative(root, path).split(sep).join('/')]
      : [];
  });

/**
 * A source with its comments blanked. A block comment opens after a space, a brace or a bracket
 * (so `'image/*'` is not one); a line comment never follows a colon or a quote (so `https://` and
 * `'//'` stay code). A quotation of the old screen in a comment is prose, not code.
 */
export const stripComments = (text: string): string =>
  text.replace(/(^|[\s{(,;])\/\*[\s\S]*?\*\//gu, '$1').replace(/(^|[^:'"`\\])\/\/[^\n]*/gu, '$1');

/**
 * Each image viewer's opening tag in `code`, whole: from the component's name to the first `>` that
 * is not inside a `{…}` — so props may wrap onto several lines and hold an arrow function
 * (`onLoad={() => a > b}`) or a self-closing element (`fallback={<Icon />}`) without ending the tag
 * early. (The group in the pattern keeps this file's own text from reading as a tag.)
 */
export const zoomableTags = (code: string): string[] =>
  code
    .split(/<(?:ZoomableImage)\b/u)
    .slice(1)
    .map((rest) => {
      let depth = 0;
      for (let i = 0; i < rest.length; i += 1) {
        const c = rest[i];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === '>' && depth === 0) return rest.slice(0, i);
      }
      return rest;
    });

/** A tag that opts in to Latin figures: `latinFigures` alone or `={true}` — never `={false}`. */
export const OPTS_IN_LATIN = /(?:^|\s)latinFigures(?:\s|\/|$|=\{true\})/u;
