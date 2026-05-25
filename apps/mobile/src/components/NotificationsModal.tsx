import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Text,
  View,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNotifications, type AppNotification } from '../lib/notifications';
import { useSession } from '../store/session';
import { color, space, type as t } from '@sonoqui/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const TYPE_CONFIG: Record<
  AppNotification['type'],
  { icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap; fg: string; bg: string }
> = {
  correction_pending: { icon: 'time-outline', fg: color.warning, bg: '#fff3d1' },
  correction_approved: { icon: 'checkmark-circle-outline', fg: color.success, bg: '#e8f3ec' },
  correction_rejected: { icon: 'close-circle-outline', fg: color.error, bg: '#fde4e4' },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ora';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} g`;
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

export function NotificationsModal({ visible, onClose }: Props) {
  const router = useRouter();
  const { me } = useSession();
  const notifications = useNotifications((s) => s.notifications);
  const unreadCount = useNotifications((s) => s.unreadCount);
  const refresh = useNotifications((s) => s.refresh);
  const markAsRead = useNotifications((s) => s.markAsRead);
  const markAllAsRead = useNotifications((s) => s.markAllAsRead);

  const role = me?.user.role ?? 'user';

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    refresh(role).finally(() => setLoading(false));
  }, [visible, role, refresh]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh(role);
    setRefreshing(false);
  }, [role, refresh]);

  const onMarkAll = useCallback(async () => {
    if (unreadCount === 0 || bulkLoading) return;
    setBulkLoading(true);
    try {
      await markAllAsRead();
    } finally {
      setBulkLoading(false);
    }
  }, [unreadCount, bulkLoading, markAllAsRead]);

  const filtered = useMemo(
    () => (showUnreadOnly ? notifications.filter((n) => !n.is_read) : notifications),
    [notifications, showUnreadOnly]
  );

  const onItemPress = useCallback(
    (n: AppNotification) => {
      if (!n.is_read) markAsRead(n.id);
      onClose();
      router.push('/correzioni');
    },
    [markAsRead, onClose, router]
  );

  const renderItem = useCallback(
    ({ item }: { item: AppNotification }) => {
      const cfg = TYPE_CONFIG[item.type];
      return (
        <Pressable
          onPress={() => onItemPress(item)}
          style={[
            styles.item,
            !item.is_read && [styles.unreadItem, { borderLeftColor: cfg.fg }],
          ]}>
          <View style={[styles.iconCircle, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon} size={20} color={cfg.fg} />
          </View>
          <View style={styles.itemBody}>
            <Text style={[styles.itemTitle, !item.is_read && styles.itemTitleUnread]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.itemMessage} numberOfLines={2}>
              {item.body}
            </Text>
            <Text style={styles.itemTime}>{timeAgo(item.created_at)}</Text>
          </View>
          {!item.is_read && (
            <Pressable
              onPress={() => markAsRead(item.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Segna come letta">
              <Ionicons name="checkmark-done-outline" size={20} color={color.primary} />
            </Pressable>
          )}
        </Pressable>
      );
    },
    [markAsRead, onItemPress]
  );

  const empty = (
    <View style={styles.empty}>
      <Ionicons name="notifications-off-outline" size={48} color={color.onSurfaceVariant} />
      <Text style={styles.emptyTitle}>
        {showUnreadOnly ? 'Tutto a posto' : 'Nessuna notifica'}
      </Text>
      <Text style={styles.emptySub}>
        {showUnreadOnly ? 'Nessuna notifica non letta.' : 'Aggiornamenti su correzioni qui.'}
      </Text>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>Notifiche</Text>
          <View style={styles.headerActions}>
            <Pressable
              style={[styles.iconBtn, (unreadCount === 0 || bulkLoading) && { opacity: 0.4 }]}
              onPress={onMarkAll}
              disabled={unreadCount === 0 || bulkLoading}
              accessibilityLabel="Segna tutte come lette">
              {bulkLoading ? (
                <ActivityIndicator size="small" color={color.success} />
              ) : (
                <Ionicons name="checkmark-done" size={22} color={color.success} />
              )}
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={onClose} accessibilityLabel="Chiudi">
              <Ionicons name="close" size={22} color={color.onSurface} />
            </Pressable>
          </View>
        </View>

        <View style={styles.filterRow}>
          <Pressable
            style={[styles.tab, !showUnreadOnly && styles.tabActive]}
            onPress={() => setShowUnreadOnly(false)}>
            <Text style={[styles.tabText, !showUnreadOnly && styles.tabTextActive]}>Tutte</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, showUnreadOnly && styles.tabActive]}
            onPress={() => setShowUnreadOnly(true)}>
            <Text style={[styles.tabText, showUnreadOnly && styles.tabTextActive]}>
              Non lette{unreadCount > 0 ? ` · ${unreadCount}` : ''}
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={color.primary} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(n) => n.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={empty}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
    paddingBottom: space.s2,
  },
  title: { fontSize: 22, fontWeight: '700', color: color.onSurface, letterSpacing: -0.4 },
  headerActions: { flexDirection: 'row', gap: 4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  filterRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: space.s4,
    paddingBottom: space.s3,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: color.surfaceVariant,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: color.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: color.onSurfaceVariant },
  tabTextActive: { color: color.onPrimary },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  listContent: { paddingHorizontal: 6, paddingBottom: 32, gap: 8 },

  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  unreadItem: { backgroundColor: '#fffbf8' },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: { flex: 1 },
  itemTitle: { fontSize: 14, fontWeight: '600', color: color.onSurface },
  itemTitleUnread: { fontWeight: '700' },
  itemMessage: { fontSize: 13, color: color.onSurfaceVariant, marginTop: 2 },
  itemTime: { fontSize: 11, color: color.onSurfaceVariant, marginTop: 6, fontWeight: '500' },

  empty: { alignItems: 'center', paddingVertical: 64, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: color.onSurface, marginTop: 8 },
  emptySub: { fontSize: 13, color: color.onSurfaceVariant, textAlign: 'center', paddingHorizontal: 24 },
});
