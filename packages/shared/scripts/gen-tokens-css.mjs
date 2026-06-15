// Generates packages/shared/src/design/tokens.css from the `color` object in
// tokens.ts, so web + website consume the same brand palette mobile already
// imports. Run with `npm run tokens`. Pure Node — no flags, no deps — it parses
// the flat token object by regex, so it is insensitive to the Node version.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const tokensPath = join(here, '..', 'src', 'design', 'tokens.ts');
const outPath = join(here, '..', 'src', 'design', 'tokens.css');

const src = readFileSync(tokensPath, 'utf8');

const block = src.match(/export\s+const\s+color\s*=\s*\{([\s\S]*?)\}\s*as\s+const/);
if (!block) {
  console.error('gen-tokens-css: could not find `export const color = { … } as const` in tokens.ts');
  process.exit(1);
}

// Match `key: 'value'` pairs only — comment lines have no quoted value and are skipped.
const pairs = [];
const re = /(\w+)\s*:\s*'([^']+)'/g;
let m;
while ((m = re.exec(block[1])) !== null) pairs.push([m[1], m[2]]);

const required = ['primary', 'onPrimary', 'secondary', 'surface'];
const missing = required.filter((k) => !pairs.some(([key]) => key === k));
if (missing.length) {
  console.error(`gen-tokens-css: missing required token(s): ${missing.join(', ')}`);
  process.exit(1);
}

const kebab = (s) => s.replace(/([A-Z])/g, (ch) => '-' + ch.toLowerCase());
const lines = pairs.map(([k, v]) => `  --color-${kebab(k)}: ${v};`).join('\n');

const css = `/* AUTO-GENERATED from tokens.ts by \`npm run tokens\`. Do not edit by hand. */
@theme {
${lines}
}
`;

writeFileSync(outPath, css);
console.log(`gen-tokens-css: wrote tokens.css (${pairs.length} colors)`);
