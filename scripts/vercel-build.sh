#!/usr/bin/env bash
set -euo pipefail

if ! command -v dotnet >/dev/null 2>&1; then
  curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/ahm-dotnet-install.sh
  bash /tmp/ahm-dotnet-install.sh --channel 10.0 --install-dir "$PWD/.dotnet"
  export PATH="$PWD/.dotnet:$PATH"
fi

npm run build
