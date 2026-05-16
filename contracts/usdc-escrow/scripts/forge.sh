#!/usr/bin/env sh
set -eu

if [ -n "${FORGE_BIN:-}" ]; then
  exec "$FORGE_BIN" "$@"
fi

if command -v forge >/dev/null 2>&1; then
  exec forge "$@"
fi

if [ -x "$HOME/.foundry/bin/forge" ]; then
  exec "$HOME/.foundry/bin/forge" "$@"
fi

if [ -x /root/.foundry/bin/forge ]; then
  exec /root/.foundry/bin/forge "$@"
fi

echo "forge not found. Install Foundry or set FORGE_BIN=/path/to/forge." >&2
exit 127
