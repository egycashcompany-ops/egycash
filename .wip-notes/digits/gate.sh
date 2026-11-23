#!/usr/bin/env bash
# The CI gate, in CI order (.github/workflows/ci.yml), CI=true. npm ci is CI-only (node_modules present).
# Run ALONE (no other vitest at the same time). Logs: $G.
cd /home/user/egycash || exit 1
export CI=true
G=/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/digits/gate-out
mkdir -p $G; : > $G/summary.txt
echo "HEAD $(git rev-parse --short HEAD) $(date -u +%FT%TZ)" >> $G/summary.txt
git ls-files --others --ignored --exclude-standard -- apps | grep "/zz-" > $G/00-cleanroom.log; echo "00-cleanroom lines=$(wc -l < $G/00-cleanroom.log) (must be 0)" >> $G/summary.txt
run() { local n="$1"; shift; local start=$(date +%s); "$@" > "$G/$n.log" 2>&1; local rc=$?; echo "$n rc=$rc $(( $(date +%s) - start ))s" >> $G/summary.txt; return 0; }
run 01-secrets node scripts/check-secrets.mjs
echo "02-npm-ci skipped (CI only; node_modules installed)" >> $G/summary.txt
run 03-contracts-build npm run build -w packages/contracts
# `npm run lint` minus the temporary notes folder: CI never sees `.wip-notes/` (removed before the PR),
# and its workflow.js (harness globals) would stop the root pass before apps/api and apps/web are linted.
lint() { npx eslint . --ignore-pattern "apps/api/**" --ignore-pattern "apps/web/**" --ignore-pattern ".wip-notes/**" && npx eslint apps/api && npx eslint apps/web; }
run 04-lint lint
run 05-typecheck npm run typecheck --workspaces --if-present
run 06-perm node scripts/gen-permission-matrix.mjs --check
run 07-flags node scripts/check-flag-expiry.mjs
run 08-pages node scripts/check-page-registry.mjs
run 09-autotpl node scripts/automation-templates.mjs
run 10-formal node scripts/check-formal-arabic.mjs
run 11-contracts-test npm run test -w packages/contracts
run 12-api-test npm run test -w apps/api
run 13-web-test npm run test -w apps/web
run 14-build npm run build
run 15-audit node scripts/dependency-audit.mjs
git status --porcelain -- . ':!.wip-notes' > $G/99-git-status.log; echo "99-git-status lines=$(wc -l < $G/99-git-status.log)" >> $G/summary.txt
echo DONE >> $G/summary.txt
