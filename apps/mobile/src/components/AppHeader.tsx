import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { color, space, type as t } from '@sonoqui/shared';
import { useSession } from '../store/session';
import { NotificationBell } from './NotificationBell';
import { userInitial } from '../lib/user-display';

interface AppHeaderProps {
  rightSlot?: React.ReactNode;
  centerSlot?: React.ReactNode;
}

export function AppHeader({ rightSlot, centerSlot }: AppHeaderProps) {
  const router = useRouter();
  const { me } = useSession();
  const initial = me ? userInitial(me.user) : '?';

  return (
    <View style={styles.topBar}>
      <TouchableOpacity
        onPress={() => router.push('/profilo')}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Profilo">
        <View style={styles.profileIcon}>
          <Text style={styles.profileInitial}>{initial}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.center}>{centerSlot}</View>
      <View style={styles.right}>{rightSlot ?? <NotificationBell />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingTop: space.s4,
    paddingBottom: space.s2,
  },
  profileIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    color: color.onPrimary,
    fontSize: t.bodyStrong.size,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.s2,
  },
  right: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
