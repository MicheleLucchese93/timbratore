import sanitizeHtml from 'sanitize-html';

// Bacheca message bodies are admin-authored rich text (TipTap on the web). The
// author is trusted-ish (an admin of the tenant), but the HTML is rendered both
// in-app (dangerouslySetInnerHTML on the web, react-native-render-html on
// mobile) and inside emails, so we sanitize on the WAY IN against a strict
// allowlist — no scripts, no styles, no event handlers, no remote images. Text
// formatting + safe links only, matching the "text + links" product scope.

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4',
  'blockquote', 'code', 'pre',
  'a', 'span',
];

/** Sanitize admin-authored HTML to the Bacheca allowlist. Returns safe HTML. */
export function sanitizeBulletinHtml(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    // Links may only point at http(s)/mailto/tel; everything else (javascript:,
    // data:, etc.) is dropped.
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { a: ['http', 'https', 'mailto', 'tel'] },
    // Force every surviving link to open safely in a new tab.
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
    // Strip class/style/etc. attributes everywhere by not listing them above.
    disallowedTagsMode: 'discard',
  }).trim();
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * Flatten HTML to a single-line plain-text preview for push bodies / email text
 * parts. Tags are dropped, common entities decoded, whitespace collapsed.
 */
export function htmlToPlainText(html: string, maxLen = 200): string {
  const stripped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  const decoded = stripped.replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? m);
  const collapsed = decoded.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen - 1)}…` : collapsed;
}
