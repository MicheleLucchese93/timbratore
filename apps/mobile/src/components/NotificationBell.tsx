import { useState, useCallback, useEffect } from 'react';
import { Pressable, View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNotifications } from '../lib/notifications';
import { useSession } from '../store/session';
import { color } from '@sonoqui/shared';
import { NotificationsModal } from './NotificationsModal';

export function NotificationBell() {
  const { me } = useSession();
  const unreadCount = useNotifications((s) => s.unreadCount);
  const refresh = useNotifications((s) => s.refresh);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!me) return;
    refresh();
  }, [me, refresh]);

  const onOpen = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <Pressable
        style={styles.bellButton}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel="Notifiche">
        <View style={styles.bellCircle}>
          <Ionicons name="notifications-outline" size={20} color={color.primary} />
        </View>
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
      </Pressable>
      <NotificationsModal visible={open} onClose={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  bellButton: { position: 'relative' },
  bellCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: color.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: color.surface,
  },
  badgeText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
});
