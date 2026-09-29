import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const preloadLinks = html.match(/<link\b(?=[^>]*\brel=["']preload["'])[^>]*>/gi) ?? [];
const invalidPreload = preloadLinks.find(link => !/\bhref=["'][^"']+["']/i.test(link));

if (invalidPreload) {
  throw new Error(`Published HTML contains a preload link without an href: ${invalidPreload}`);
}

if (/\bid=["']webassembly["']/i.test(html)) {
  throw new Error('Published HTML still contains the WebAssembly preload placeholder.');
}

console.log(`Verified ${preloadLinks.length} published preload links.`);
