#!/usr/bin/env node
// Tells IndexNow-capable engines (Bing, Yandex, Naver — not Google) which URLs
// changed, instead of waiting for their next crawl. Bing and Yandex already
// crawl sonoqui.pro regularly; this turns "eventually" into "now" after a
// deploy. Run it after `deploy.sh` has finished, never before — the engines
// re-fetch immediately and must see the new build.
//
//   node apps/website/scripts/indexnow-submit.mjs            # every sitemap URL
//   node apps/website/scripts/indexnow-submit.mjs /it/ /it/partner/
//
// The key is the file name of the single *.txt under public/ whose content is
// its own name (IndexNow's ownership proof). Rotating it = replace that file.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOST = "sonoqui.pro";
const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const keyFile = readdirSync(pub).find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
if (!keyFile) {
  console.error("No IndexNow key file (public/<32-hex>.txt) found.");
  process.exit(2);
}
const key = readFileSync(join(pub, keyFile), "utf8").trim();

let paths = process.argv.slice(2);
if (paths.length === 0) {
  const xml = await (await fetch(`https://${HOST}/sitemap-0.xml`)).text();
  paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
}
const urlList = paths.map((p) => `https://${HOST}${p.startsWith("/") ? p : `/${p}`}`);

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${keyFile}`, urlList }),
});
// 200 = accepted, 202 = accepted pending key validation. Anything else is a
// real problem (403 = key file not reachable at keyLocation, 422 = bad URLs).
console.log(`IndexNow ${res.status} ${res.statusText} — ${urlList.length} URL(s)`);
process.exit(res.status === 200 || res.status === 202 ? 0 : 1);
