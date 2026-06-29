/**
 * UpdateGateScreen
 *
 * Full-screen view shown while an OTA update is being downloaded + applied
 * (useUpdateGate phase === 'applying'). Mirrors the launch splash style
 * (#fffbf8 background) so users perceive it as a continuation of the launch
 * sequence, not a distinct modal.
 *
 * Copy comes from the `common` i18n namespace. If i18n hasn't hydrated yet
 * (the gate can paint during cold start, before the persisted language is
 * applied), we fall back to the raw Italian string rather than show the key
 * literal — Italian is the primary user language.
 */

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

const SPLASH_BG = '#fffbf8';
const BRAND_PRIMARY = '#15569e';

export function UpdateGateScreen() {
  const { t, ready } = useTranslation('common');
  const label = ready ? t('updateGate.applying') : 'Aggiornamento in corso…';

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={BRAND_PRIMARY} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#334155',
    fontSize: 15,
    marginTop: 16,
    textAlign: 'center',
  },
});
