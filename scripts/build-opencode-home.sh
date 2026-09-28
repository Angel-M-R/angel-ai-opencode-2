#!/bin/sh
# Build the exact OpenCode source plus the small Angel home-logo extension.
set -eu
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_dir=${ANGEL_OPENCODE_SOURCE:-${XDG_CACHE_HOME:-$HOME/.cache}/angel-ai/opencode-2.0.18}
revision=cd9a14a6b688d4021bee381dfd39d2cef9c0f862
patch_file="$repo_dir/patches/opencode-2.0.18-home-logo.patch"
output_dir="$repo_dir/.build/opencode"

if [ ! -d "$source_dir/.git" ]; then
  mkdir -p "$source_dir"
  git -C "$source_dir" init
  git -C "$source_dir" remote add origin https://github.com/anomalyco/opencode.git
  git -C "$source_dir" fetch --depth=1 origin "$revision"
  git -C "$source_dir" checkout --detach FETCH_HEAD
fi
if [ "$(git -C "$source_dir" rev-parse HEAD)" != "$revision" ]; then
  echo "Source must be at $revision; refusing to change a different checkout." >&2
  exit 1
fi
if git -C "$source_dir" diff --quiet HEAD; then
  git -C "$source_dir" apply --check "$patch_file"
  git -C "$source_dir" apply "$patch_file"
else
  # Never reset a source checkout containing unrelated edits.
  actual_patch=$(mktemp)
  trap 'rm -f "$actual_patch"' EXIT HUP INT TERM
  git -C "$source_dir" diff HEAD -- > "$actual_patch"
  if ! cmp -s "$actual_patch" "$patch_file"; then
    echo "Source contains edits other than the expected Angel patch." >&2
    exit 1
  fi
fi
cd "$source_dir"
npm exec --yes --package=bun@1.4.2 -- bun install --frozen-lockfile
OPENCODE_VERSION=2.0.18 OPENCODE_CHANNEL=latest \
  npm exec --yes --package=bun@1.4.2 -- bun run packages/cli/script/build.ts \
  --single --skip-install "--outdir=$output_dir"
printf '\nBuilt patched OpenCode in %s\n' "$output_dir"
