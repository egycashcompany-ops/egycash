// Feature flags are temporary by construction (Review R27): a flag past its
// expiry date fails CI until it is removed or its expiry is deliberately extended.
const { featureFlags } = await import(
  new URL('../packages/contracts/dist/index.js', import.meta.url).href
);

const today = new Date().toISOString().slice(0, 10);
const expired = featureFlags.filter((flag) => flag.expiresAt < today);

if (expired.length > 0) {
  for (const flag of expired) {
    process.stderr.write(
      `EXPIRED FLAG: ${flag.key} (owner: ${flag.owner}, expired: ${flag.expiresAt}) — remove it or extend the expiry via PR review.\n`,
    );
  }
  process.exit(1);
}
process.stdout.write(`feature flags OK (${featureFlags.length} declared, none expired)\n`);
