#!/usr/bin/env bash
# Vercel's Ignored Build Step (vercel.json "ignoreCommand"). Exit 0 = skip
# the build, exit 1 = build. Any other exit code is a deployment ERROR, so
# every path below ends in 0 or 1. The history is in DECISIONS.md
# (29 Sep, 15 Oct and 28 Oct 2026).

# Dependabot branches never build: their pull requests are checked by CI.
if [ "${VERCEL_GIT_COMMIT_REF#dependabot/}" != "$VERCEL_GIT_COMMIT_REF" ]; then
  exit 0
fi

# A Redeploy of the commit that is already live always builds. It is how a
# changed environment variable reaches the site (go-live steps B1 and C8),
# and it changes no files, so the docs-only rule below would cancel it.
if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ] && [ "$VERCEL_GIT_PREVIOUS_SHA" = "$VERCEL_GIT_COMMIT_SHA" ]; then
  exit 1
fi

# Otherwise skip only when nothing but Markdown and LICENSE changed since the
# last successful deployment. If that commit is not in Vercel's shallow clone,
# build rather than guess.
BASE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
git cat-file -e "$BASE" 2>/dev/null || exit 1
git diff --quiet "$BASE" HEAD -- ':!*.md' ':!LICENSE' && exit 0
exit 1
