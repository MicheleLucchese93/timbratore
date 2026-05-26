import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { color } from '@sonoqui/shared';

const TAB_BAR_CONTENT_HEIGHT = 54;
const TAB_ICON_SIZE = 24;
const LABEL_FONT_SIZE = 10;
const ACTIVE_LINE_WIDTH = 48;
const ACTIVE_LINE_HEIGHT = 3;
const LINE_TO_ICON_GAP = 6;
const ICON_TO_LABEL_GAP = 3;

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  timbrature: 'time-outline',
  storico: 'calendar-outline',
  correzioni: 'create-outline',
  richieste: 'sunny-outline',
  profilo: 'person-outline',
};

export function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 4);

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
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
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
                  <Ionicons
                    name={iconName}
                    size={TAB_ICON_SIZE}
                    color="#FFFFFF"
                    style={!isFocused ? styles.tabIconInactive : undefined}
                  />
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
  tabLabel: {
    fontSize: LABEL_FONT_SIZE,
    fontWeight: '500',
    color: '#FFFFFF',
    marginTop: ICON_TO_LABEL_GAP,
  },
  tabLabelActive: { opacity: 1 },
  tabLabelInactive: { opacity: 0.6 },
});
