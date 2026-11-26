#!/bin/sh
# 타입 검사. Orca 는 플러그인 폴더 안의 node_modules(심볼릭 링크 포함)를 콘텐츠로 거부하므로
# typescript 와 @types/node 는 사용자 캐시에 한 번 설치해 두고 쓴다.
set -e
cd "$(dirname "$0")/.."
TOOLS="${XDG_CACHE_HOME:-$HOME/.cache}/workspace-explorer-tools"
if [ ! -x "$TOOLS/node_modules/.bin/tsc" ] || [ ! -d "$TOOLS/node_modules/@types/node" ]; then
  mkdir -p "$TOOLS"
  npm install --prefix "$TOOLS" --silent --no-fund --no-audit typescript@5 @types/node@22
fi
exec "$TOOLS/node_modules/.bin/tsc" -p . --typeRoots "./.orca/types,$TOOLS/node_modules/@types"
