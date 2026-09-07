#!/bin/zsh
set -e
cd "${0:A:h}"
SEVEN_BUNDLE="/Users/charles/.cache/codex-runtimes/codex-primary-runtime/dependencies"
if [[ -x "$SEVEN_BUNDLE/node/bin/node" ]]; then
  export PATH="$SEVEN_BUNDLE/node/bin:$PATH"
fi
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run build
if [[ -x "$SEVEN_BUNDLE/python/bin/python3" ]]; then
  export PATH="$SEVEN_BUNDLE/bin/override:$SEVEN_BUNDLE/bin/fallback:$PATH"
  exec "$SEVEN_BUNDLE/python/bin/python3" -m http.server 4173 --bind 127.0.0.1 --directory dist
fi
exec python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
