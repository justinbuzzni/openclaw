#!/bin/bash
set -e

DEST=~/.openclaw/extensions/plugin-axiommind

rm -rf dist
npm run build && npm run build:web

# 이전 빌드 결과물 정리 후 복사
rm -rf "$DEST/dist" "$DEST/out" "$DEST/web/out"
cp -r dist package.json openclaw.plugin.json "$DEST/"
mkdir -p "$DEST/web"
cp -r web/out "$DEST/web/"
