import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { color } from '@sonoqui/shared';
import { AppHeader } from '../components/AppHeader';
import { BachecaFeed } from '../components/BachecaFeed';

export function BachecaScreen() {
  const { t } = useTranslation('bacheca');
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader centerSlot={<Text style={styles.headerTitle}>{t('title')}</Text>} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <BachecaFeed />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  headerTitle: { fontSize: 18, fontWeight: '700', color: color.onSurface },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 6, paddingTop: 8, paddingBottom: 44 },
});
