#!/bin/bash
# Lines this PR added to $1 that prettier would rewrite (should print nothing).
f=$1
S=/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/stitch-dash/build-cl/hub
cd /home/user/egycash-dash
git diff -U0 HEAD -- "$f" | grep '^+' | grep -v '^+++' | sed 's/^+//' | sort -u > $S/added.txt
npx prettier --stdin-filepath "$f" < "$f" > $S/pretty.txt
diff "$f" $S/pretty.txt | grep '^<' | sed 's/^< //' | sort -u > $S/rewritten.txt
comm -12 $S/added.txt $S/rewritten.txt
