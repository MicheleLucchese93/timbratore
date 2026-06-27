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
  ul: { marginTop: 0, marginBottom: 8 },
  ol: { marginTop: 0, marginBottom: 8 },
  li: { marginBottom: 2 },
  h1: { fontSize: 17, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  h2: { fontSize: 16, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  h3: { fontSize: 15, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  h4: { fontSize: 14, fontWeight: '700', marginTop: 4, marginBottom: 4 },
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
