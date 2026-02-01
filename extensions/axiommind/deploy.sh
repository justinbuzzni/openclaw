rm -rf dist 
npm run build && npm run build:web
cp -r dist web/out package.json openclaw.plugin.json ~/.openclaw/extensions/plugin-axiommind/
