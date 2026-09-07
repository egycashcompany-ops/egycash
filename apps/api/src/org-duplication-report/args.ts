// Where the report finds its database. Pure, so it can be tested without a process.
//
// Three ways in, in order of precedence, each one added because an operator actually hit the gap
// before it:
//
//   --uri <value> / --uri=<value>   the documented form
//   a bare mongodb:// argument      what arrives when the flag is lost between two nested
//                                   `npm run … --` layers on Windows — the value survives, the
//                                   flag does not, and refusing it would refuse the one thing
//                                   the operator was clearly trying to hand us
//   MONGO_URI                       the environment, for whoever prefers not to type it
//
// Precedence is explicit-first so a stale MONGO_URI in somebody's shell cannot silently win over
// the database they just named on the command line.
const MONGO_SCHEMES = ['mongodb://', 'mongodb+srv://'] as const;

export const looksLikeMongoUri = (value: string): boolean =>
  MONGO_SCHEMES.some((scheme) => value.startsWith(scheme));

/**
 * When nothing resolved but an argument clearly TRIED to be a connection string, say what is wrong
 * with it — precisely, and without echoing it.
 *
 * The case this was written for: an operator pasted an Atlas string into a template that already
 * began with `mongodb:`, and the process received `mongodb:mongodb+srv://…`. "No database to read"
 * is true and useless; "the scheme is doubled" is what they needed. Only the part up to and
 * including the first `://` is ever shown — everything after it is the credential.
 */
export const diagnoseUri = (argv: readonly string[]): string | null => {
  const tried = argv.find((a) => /mongodb/i.test(a) && !looksLikeMongoUri(a));
  if (tried === undefined) return null;
  const schemeEnd = tried.indexOf('://');
  const shown = schemeEnd === -1 ? tried.slice(0, 16) : tried.slice(0, schemeEnd + 3);
  const doubled = /^mongodb:mongodb(\+srv)?:\/\//i.test(tried);
  return doubled
    ? `The connection string starts with "${shown}" — the scheme is doubled. ` +
        'It must start with "mongodb+srv://" (or "mongodb://") with nothing in front of it: copy the ' +
        'string exactly as Atlas gives it.'
    : `An argument starting with "${shown}" mentions mongodb but is not a connection string. ` +
        'It must start with "mongodb+srv://" or "mongodb://".';
};

export const resolveUri = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): string => {
  const flag = argv.indexOf('--uri');
  if (flag !== -1 && argv[flag + 1] !== undefined) return String(argv[flag + 1]).trim();
  const inline = argv.find((a) => a.startsWith('--uri='));
  if (inline !== undefined) return inline.slice('--uri='.length).trim();
  const bare = argv.find((a) => looksLikeMongoUri(a));
  if (bare !== undefined) return bare.trim();
  return (env.MONGO_URI ?? '').trim();
};
