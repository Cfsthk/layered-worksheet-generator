#!/bin/zsh
set -e
cd "${0:A:h}"
SEVEN_BUNDLE="/Users/charles/.cache/codex-runtimes/codex-primary-runtime/dependencies"
if [[ -x "$SEVEN_BUNDLE/python/bin/python3" ]]; then
  export PATH="$SEVEN_BUNDLE/bin/override:$SEVEN_BUNDLE/bin/fallback:$PATH"
  exec "$SEVEN_BUNDLE/python/bin/python3" serve.py
fi
exec python3 serve.py
