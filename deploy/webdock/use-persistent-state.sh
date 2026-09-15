#!/usr/bin/env sh
set -eu

STATE_ROOT="${AMARKTAI_PERSISTENT_STATE_ROOT:-}"
[ -n "$STATE_ROOT" ] || exit 0
case "$STATE_ROOT" in
  /*) ;;
  *)
    echo "AMARKTAI_PERSISTENT_STATE_ROOT must be an absolute path." >&2
    exit 1
    ;;
esac

mkdir -p "$STATE_ROOT/config" "$STATE_ROOT/files/connector-evidence" "$STATE_ROOT/backups"

for name in config files backups; do
  path="deploy/webdock/$name"
  target="$STATE_ROOT/$name"
  if [ -L "$path" ]; then
    [ "$(readlink -f "$path")" = "$(readlink -f "$target")" ] || {
      echo "$path already points at a different persistent state path." >&2
      exit 1
    }
    continue
  fi
  if [ -e "$path" ]; then
    [ "$(readlink -f "$path")" = "$(readlink -f "$target")" ] || {
      echo "$path exists locally; refusing to replace it with persistent state." >&2
      exit 1
    }
    continue
  fi
  ln -s "$target" "$path"
done
