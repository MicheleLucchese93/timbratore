#!/usr/bin/env node
// Generates the down-sized webp variants the homepage hero references in its
// srcset (see src/components/Hero.astro). The source screenshots are 1170px
// device captures that render at 144–256 css px, so shipping them whole meant
// fetching ~140 KB at fetchpriority=high for a thumbnail-sized box.
//
// Outputs are committed under public/screenshots/ rather than generated on
// every build: they change only when the source screenshots do, and the
// Docker build stage has no reason to pull sharp's native binary.
//
//   node apps/website/scripts/hero-variants.mjs
//
// Widths: 384 covers the mobile/tablet boxes at 2x, 576 covers the desktop
// 256px box at 2x with headroom. The original webp stays as the 1170w candidate.

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { statSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "public", "screenshots");
const SOURCES = ["storico", "timbra"];
const WIDTHS = [384, 576];

for (const name of SOURCES) {
  const input = join(dir, `${name}.png`);
  for (const width of WIDTHS) {
    const output = join(dir, `${name}-${width}.webp`);
    await sharp(input).resize({ width }).webp({ quality: 80 }).toFile(output);
    console.log(`${name}-${width}.webp  ${(statSync(output).size / 1024).toFixed(1)} KB`);
  }
}
