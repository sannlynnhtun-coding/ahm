import { readFile } from 'node:fs/promises';

const indexUrl = new URL('../dist/index.html', import.meta.url);
const html = await readFile(indexUrl, 'utf8');
const preloadLinks = html.match(/<link\b(?=[^>]*\brel=["']preload["'])[^>]*>/gi) ?? [];
const invalidPreload = preloadLinks.find(link => !/\bhref=["'][^"']+["']/i.test(link));

if (invalidPreload) {
  throw new Error(`Published HTML contains a preload link without an href: ${invalidPreload}`);
}

if (/\bid=["']webassembly["']/i.test(html)) {
  throw new Error('Published HTML still contains the WebAssembly preload placeholder.');
}

const bootSource = html.match(
  /<script\b[^>]*\bsrc=["']([^"']*blazor\.webassembly[^"']*\.js)["'][^>]*>/i
)?.[1];

if (!bootSource) {
  throw new Error('Published HTML does not reference the Blazor WebAssembly boot script.');
}

const bootUrl = new URL(bootSource, indexUrl);
let bootScript;
try {
  bootScript = await readFile(bootUrl, 'utf8');
} catch {
  throw new Error(`Published HTML references a missing boot script: ${bootSource}`);
}

const runtimeSource = bootScript.match(/["'](\.\/dotnet(?:\.[a-z0-9]+)?\.js)["']/i)?.[1];
if (!runtimeSource) {
  throw new Error('Blazor boot script does not reference a .NET runtime module.');
}

try {
  await readFile(new URL(runtimeSource, bootUrl));
} catch {
  throw new Error(`Blazor boot script references a missing runtime module: ${runtimeSource}`);
}

console.log(`Verified the published Blazor boot chain and ${preloadLinks.length} preload links.`);
