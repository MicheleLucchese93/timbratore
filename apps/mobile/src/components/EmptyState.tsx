import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, space } from '@sonoqui/shared';

/**
 * Shared empty-state card: a soft tinted icon badge, a title, and an optional
 * one-line subtitle. Used across the list screens (Bacheca, Storico, Documenti,
 * Richieste, Correzioni, Dashboard) so every "nothing here yet" looks the same.
 * UI only — callers keep their own empty/loading logic.
 */
export function EmptyState({
  icon,
  title,
  subtitle,
  style,
  fill,
  bare,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * When the empty state is the whole page's content, set `fill` so the card
   * centers in the available vertical space instead of sitting at the top.
   * Requires the surrounding ScrollView `contentContainerStyle` to grow
   * (`flexGrow: 1`) so there is height to fill.
   */
  fill?: boolean;
  /** Drop the white card chrome (background + shadow) — icon/title/subtitle
   * sit directly on the page. */
  bare?: boolean;
}) {
  return (
    <View style={[styles.card, fill && styles.cardFill, bare && styles.cardBare, style]}>
      <View style={styles.badge}>
        <Ionicons name={icon} size={26} color={color.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // `fill` stretches the card to consume all vertical space in its scroll
  // container (content stays centered), instead of a top-anchored small card.
  cardFill: { flex: 1, justifyContent: 'center' },
  // `bare` strips the white card so the empty state blends into the page.
  cardBare: { backgroundColor: 'transparent', shadowOpacity: 0, elevation: 0 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingVertical: space.s6,
    paddingHorizontal: space.s5,
    alignItems: 'center',
    gap: space.s2,
    shadowColor: 'rgba(0,0,0,0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 1,
  },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: color.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.s1,
  },
  title: { fontSize: 15, fontWeight: '700', color: color.onSurface, textAlign: 'center' },
  subtitle: { fontSize: 13, lineHeight: 18, color: color.onSurfaceVariant, textAlign: 'center' },
});
