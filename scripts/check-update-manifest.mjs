import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const tag = process.argv[3];
assert.equal(manifest.version.replace(/^v/, ''), tag.replace(/^v/, ''));
for (const platform of ['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64', 'linux-x86_64']) {
  const artifact = manifest.platforms?.[platform];
  assert.ok(artifact?.signature?.trim(), `Missing signature for ${platform}`);
  assert.ok(artifact.url.startsWith(`https://github.com/Ceusters-be/DataGoblin/releases/download/${tag}/`), `Invalid URL for ${platform}`);
}
console.log('All four updater platforms are present and signed');
