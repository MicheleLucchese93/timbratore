import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { color } from '@sonoqui/shared';
import { AppHeader } from '../components/AppHeader';
import { BachecaFeed, type BachecaFeedHandle } from '../components/BachecaFeed';

export function BachecaScreen() {
  const feedRef = useRef<BachecaFeedHandle>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await feedRef.current?.refresh();
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={color.primary}
            colors={[color.primary]}
          />
        }>
        <BachecaFeed ref={feedRef} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 6, paddingTop: 8, paddingBottom: 44 },
});
