import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { color } from '@sonoqui/shared';
import { useSession } from '../store/session';
import { useBacheca } from '../store/bacheca';

const TAB_BAR_CONTENT_HEIGHT = 54;
const TAB_ICON_SIZE = 24;
const LABEL_FONT_SIZE = 10;
const ACTIVE_LINE_WIDTH = 48;
const ACTIVE_LINE_HEIGHT = 3;
const LINE_TO_ICON_GAP = 6;
const ICON_TO_LABEL_GAP = 3;

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  dashboard: 'grid-outline',
  bacheca: 'megaphone-outline',
  timbrature: 'time-outline',
  richieste: 'sunny-outline',
  documenti: 'document-text-outline',
};

export function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 4);
  const me = useSession((s) => s.me);
  const bachecaUnread = useBacheca((s) => s.unread);
  const isAdmin = me?.user.role === 'admin';
  const canStamp = (me?.user.stamp_modes ?? []).length > 0;
  const focusedKey = state.routes[state.index]?.key;
  // Dashboard is admin-only; Timbrature hides when no stamp method is enabled.
  // Storico is not a bottom tab — it lives as a sub-tab inside Timbrature.
  const routes = state.routes.filter((r) => {
    if (r.name === 'dashboard') return isAdmin;
    if (r.name === 'timbrature') return canStamp;
    return true;
  });

  return (
    <View
      style={[
        styles.tabBarWrapper,
        {
          backgroundColor: color.primary,
          paddingBottom: bottomInset,
          height: TAB_BAR_CONTENT_HEIGHT + bottomInset,
        },
      ]}>
      <View style={styles.tabBar}>
        {routes.map((route) => {
          const { options } = descriptors[route.key];
          const isFocused = route.key === focusedKey;
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : (options.title ?? route.name);
          const iconName = TAB_ICONS[route.name] ?? 'ellipse-outline';

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={label}
              onPress={onPress}
              style={styles.tabButton}
              activeOpacity={0.7}>
              <View style={styles.tabContent}>
                <View style={styles.activeLineSlot}>
                  {isFocused && <View style={styles.activeTabLine} />}
                </View>
                <View style={styles.iconLabelWrap}>
                  <View>
                    <Ionicons
                      name={iconName}
                      size={TAB_ICON_SIZE}
                      color="#FFFFFF"
                      style={!isFocused ? styles.tabIconInactive : undefined}
                    />
                    {route.name === 'bacheca' && bachecaUnread > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                          {bachecaUnread > 9 ? '9+' : String(bachecaUnread)}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.tabLabel,
                      isFocused ? styles.tabLabelActive : styles.tabLabelInactive,
                    ]}
                    numberOfLines={1}>
                    {label}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBarWrapper: { overflow: 'hidden' },
  tabBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 4,
    paddingHorizontal: 16,
  },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabContent: { alignItems: 'center', justifyContent: 'center' },
  activeLineSlot: {
    height: ACTIVE_LINE_HEIGHT + LINE_TO_ICON_GAP,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  activeTabLine: {
    width: ACTIVE_LINE_WIDTH,
    height: ACTIVE_LINE_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderRadius: ACTIVE_LINE_HEIGHT / 2,
  },
  iconLabelWrap: { alignItems: 'center', justifyContent: 'center' },
  tabIconInactive: { opacity: 0.6 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  tabLabel: {
    fontSize: LABEL_FONT_SIZE,
    fontWeight: '500',
    color: '#FFFFFF',
    marginTop: ICON_TO_LABEL_GAP,
  },
  tabLabelActive: { opacity: 1 },
  tabLabelInactive: { opacity: 0.6 },
});
