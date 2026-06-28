import { useWindowDimensions, Linking } from 'react-native';
import RenderHtml, { type MixedStyleRecord } from 'react-native-render-html';
import { color } from '@sonoqui/shared';

// Renders a Bacheca message body. The HTML is server-sanitized to a strict
// allowlist (text formatting + safe links), so it is safe to render. Links open
// in the system browser. Isolated here so the underlying renderer can be swapped
// without touching the feed.
const TAGS_STYLES: MixedStyleRecord = {
  body: { color: color.onSurface, fontSize: 14, lineHeight: 21 },
  p: { marginTop: 0, marginBottom: 8 },
  a: { color: color.primary, textDecorationLine: 'underline' },
  strong: { fontWeight: '700' },
  b: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  u: { textDecorationLine: 'underline' },
  s: { textDecorationLine: 'line-through' },
  strike: { textDecorationLine: 'line-through' },
  ul: { marginTop: 0, marginBottom: 8 },
  ol: { marginTop: 0, marginBottom: 8 },
  li: { marginBottom: 2 },
  h1: { fontSize: 19, fontWeight: '700', marginTop: 6, marginBottom: 4 },
  h2: { fontSize: 17, fontWeight: '700', marginTop: 5, marginBottom: 4 },
  h3: { fontSize: 15, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  h4: { fontSize: 14, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: color.surfaceVariant,
    paddingLeft: 10,
    marginBottom: 8,
    color: color.onSurfaceVariant,
  },
  code: { backgroundColor: color.surfaceVariant, borderRadius: 4, paddingHorizontal: 4 },
  pre: { backgroundColor: color.surfaceVariant, borderRadius: 6, padding: 10, marginBottom: 8 },
};

const RENDERERS_PROPS = {
  a: {
    onPress: (_e: unknown, href: string) => {
      if (href) Linking.openURL(href).catch(() => {});
    },
  },
};

export function BulletinHtml({ html }: { html: string }) {
  const { width } = useWindowDimensions();
  return (
    <RenderHtml
      contentWidth={width - 56}
      source={{ html }}
      tagsStyles={TAGS_STYLES}
      renderersProps={RENDERERS_PROPS}
      defaultTextProps={{ selectable: true }}
      enableExperimentalMarginCollapsing
    />
  );
}
