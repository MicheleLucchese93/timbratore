import fs from 'node:fs';
import path from 'node:path';

import { color } from '@sonoqui/shared';

const TEMPLATES_DIR = path.resolve(process.cwd(), 'public', 'templates');

/**
 * Renders an HTML email template using a minimal subset of Go's text/template:
 *   {{ if eq .language "it" }}...{{ else }}...{{ end }}
 *   {{ .Var }}
 *
 * Grammar kept tiny — same shape as the GoTrue-rendered templates so the
 * in-repo files stay visually consistent. All `{{ .Var }}` values are
 * HTML-escaped before substitution; pass pre-escaped strings only if the
 * call site has already validated them.
 */
export function renderTemplate(
  filename: string,
  vars: Record<string, string>
): string {
  const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, filename), 'utf8');
  const lang = vars.language ?? 'it';
  const resolved = tpl.replace(
    /\{\{\s*if\s+eq\s+\.language\s+"(\w+)"\s*\}\}([\s\S]*?)\{\{\s*else\s*\}\}([\s\S]*?)\{\{\s*end\s*\}\}/g,
    (_m, want, ifBlock, elseBlock) => (lang === want ? ifBlock : elseBlock)
  );
  // Brand color comes from the shared design tokens so emails track the palette
  // automatically; callers may still override it via `vars.brandColor`.
  const merged: Record<string, string> = { brandColor: color.primary, ...vars };
  return resolved.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = merged[key];
    return v ? escapeHtml(v) : '';
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripHeader(value: string): string {
  return value.replace(/[\r\n]/g, ' ').slice(0, 998);
}
