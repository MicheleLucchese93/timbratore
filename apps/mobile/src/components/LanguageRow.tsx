import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { color, space, radius, type as t } from '@sonoqui/shared';
import { api } from '../lib/api';
import { setLanguage, type Lang, LANGS } from '../i18n';

// Language is a per-user preference: switch the UI immediately, persist locally,
// then sync to the server (PATCH /me). A failed sync is non-fatal — the choice
// still applies on this device and is retried on the next change.
async function change(lng: Lang) {
  await setLanguage(lng);
  try {
    await api('/api/v1/me', { method: 'PATCH', json: { language: lng } });
  } catch {
    /* keep the local choice even if the server sync fails */
  }
}

/** Settings row with a segmented IT|EN toggle. Drop into a Profilo card. */
export function LanguageRow() {
  const { t: tr, i18n } = useTranslation('common');
  const cur: Lang = i18n.language === 'en' ? 'en' : 'it';
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{tr('lang.label')}</Text>
      <View style={styles.segment}>
        {LANGS.map((l) => {
          const active = cur === l;
          return (
            <Pressable
              key={l}
              onPress={() => void change(l)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {tr(`lang.${l}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.s3,
  },
  label: {
    fontSize: t.body.size,
    color: color.onSurface,
    flex: 1,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: color.surfaceVariant,
    borderRadius: radius.md,
    padding: 2,
  },
  segmentBtn: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s1,
    borderRadius: radius.sm,
  },
  segmentBtnActive: {
    backgroundColor: color.surface,
  },
  segmentText: {
    fontSize: t.caption.size,
    fontWeight: '600',
    color: color.onSurfaceVariant,
  },
  segmentTextActive: {
    color: color.primary,
  },
});
