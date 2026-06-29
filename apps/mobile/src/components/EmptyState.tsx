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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.badge}>
        <Ionicons name={icon} size={26} color={color.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
