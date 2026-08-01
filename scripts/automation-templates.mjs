// Validates the checked-in automation template packages against the REAL contract schema
// (`AutomationTemplatePackageSchema`), and previews one as a standalone n8n-importable workflow.
//
// A template package is data, not code — which is exactly why it needs a check in CI. A package
// that fails to parse installs as nothing, and the failure surfaces on a production instance
// rather than here.
//
//   node scripts/automation-templates.mjs                    # validate every package
//   node scripts/automation-templates.mjs --preview <key>    # emit an importable n8n workflow
//
// The preview prepends the SAME webhook trigger node A-6a's `webhookNode()` builds, so a package
// can be opened, wired and stepped through in the n8n UI before A-6a/A-9 are deployed. The path is
// a throwaway UUID: n8n will not receive real ECMS dispatches on it.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatesDir = join(root, 'automation', 'templates');

const { AutomationTemplatePackageSchema } = await import(
  new URL('../packages/contracts/dist/index.js', import.meta.url).href
);

const files = readdirSync(templatesDir)
  .filter((name) => name.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error(`no template packages found in ${templatesDir}`);
  process.exit(1);
}

const packages = new Map();
let failed = 0;

for (const file of files) {
  const raw = readFileSync(join(templatesDir, file), 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`✗ ${file}: not valid JSON — ${error.message}`);
    failed += 1;
    continue;
  }

  const result = AutomationTemplatePackageSchema.safeParse(parsed);
  if (!result.success) {
    console.error(`✗ ${file}: does not match AutomationTemplatePackageSchema`);
    for (const issue of result.error.issues) {
      console.error(`    ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    failed += 1;
    continue;
  }

  const pkg = result.data;
  const graph = pkg.graph.nodes ?? {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const connections = graph.connections ?? {};
  const names = new Set(nodes.map((node) => node.name));

  // The trigger node is NOT in the package — A-6a prepends it. Every graph must therefore connect
  // from a node called exactly `ECMS Trigger`, or nothing it contains will ever run.
  const problems = [];
  if (connections['ECMS Trigger'] === undefined) {
    problems.push("no connection from 'ECMS Trigger' — the graph is unreachable");
  }
  for (const [from, outputs] of Object.entries(connections)) {
    if (from !== 'ECMS Trigger' && !names.has(from)) {
      problems.push(`connection from unknown node '${from}'`);
    }
    for (const branch of outputs.main ?? []) {
      for (const target of branch ?? []) {
        if (!names.has(target.node)) {
          problems.push(`connection to unknown node '${target.node}'`);
        }
      }
    }
  }
  if (packages.has(pkg.key)) {
    problems.push(`duplicate key '${pkg.key}' (also in ${packages.get(pkg.key).file})`);
  }

  if (problems.length > 0) {
    console.error(`✗ ${file}:`);
    for (const problem of problems) console.error(`    ${problem}`);
    failed += 1;
    continue;
  }

  packages.set(pkg.key, { file, pkg, nodes, connections });
  console.log(
    `✓ ${pkg.key}@${pkg.version} — ${nodes.length} node(s), triggers on ${pkg.requires.events.join(', ')}`,
  );
}

const previewIndex = process.argv.indexOf('--preview');
if (previewIndex !== -1) {
  const key = process.argv[previewIndex + 1];
  const entry = packages.get(key);
  if (entry === undefined) {
    console.error(`\nunknown package '${key}'. Known: ${[...packages.keys()].join(', ')}`);
    process.exit(1);
  }
  // Mirrors `webhookNode()` in apps/api/src/platform/automation/providers/n8n/n8n.graph.ts.
  const trigger = {
    id: randomUUID(),
    name: 'ECMS Trigger',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [0, 0],
    parameters: { path: randomUUID(), httpMethod: 'POST', responseMode: 'onReceived' },
  };
  console.log(
    JSON.stringify(
      {
        name: `${entry.pkg.name.en} (preview)`,
        nodes: [trigger, ...entry.nodes],
        connections: entry.connections,
        settings: { executionOrder: 'v1' },
        pinData: {},
      },
      null,
      2,
    ),
  );
}

if (failed > 0) {
  console.error(`\n${failed} package(s) invalid`);
  process.exit(1);
}
