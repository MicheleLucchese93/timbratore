import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { color, space } from '@sonoqui/shared';

export interface SwipeableTabSpec<Id extends string = string> {
  id: Id;
  label: string;
  badge?: number;
}

interface Props<Id extends string> {
  tabs: ReadonlyArray<SwipeableTabSpec<Id>>;
  activeId: Id;
  onChange: (id: Id) => void;
  children: ReadonlyArray<ReactNode>;
}

// Penno-style swipeable tabs: underline header + horizontal paged ScrollView.
// Tap a tab to animate to its page; swipe between pages to update the header.
export function SwipeableTabs<Id extends string>({
  tabs,
  activeId,
  onChange,
  children,
}: Props<Id>) {
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeId)
  );

  useEffect(() => {
    pagerRef.current?.scrollTo({
      x: activeIndex * width,
      animated: true,
    });
  }, [activeIndex, width]);

  const handleTap = useCallback(
    (id: Id) => {
      if (id !== activeId) onChange(id);
    },
    [activeId, onChange]
  );

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / width);
      const next = tabs[idx];
      if (next && next.id !== activeId) onChange(next.id);
    },
    [tabs, activeId, onChange, width]
  );

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        {tabs.map((t) => {
          const sel = t.id === activeId;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => handleTap(t.id)}
              activeOpacity={0.7}
              style={[styles.tabBtn, sel && styles.tabBtnActive]}>
              <Text style={[styles.tabText, sel && styles.tabTextActive]}>
                {t.label}
                {t.badge != null && t.badge > 0 ? ` · ${t.badge}` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
        keyboardShouldPersistTaps="handled"
        style={styles.pager}>
        {children.map((node, i) => (
          <View key={tabs[i]?.id ?? i} style={{ width, flex: 1 }}>
            {node}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: space.s3,
    paddingBottom: space.s2,
    gap: space.s2,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: color.primary },
  tabText: { fontSize: 14, fontWeight: '500', color: color.onSurfaceVariant },
  tabTextActive: { color: color.primary, fontWeight: '700' },
  pager: { flex: 1 },
});
