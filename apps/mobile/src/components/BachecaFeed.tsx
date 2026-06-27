import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { color, space } from '@sonoqui/shared';
import type { BulletinFeedItem } from '@sonoqui/shared';
import { api } from '../lib/api';
import { fmtDate } from '../i18n/format';
import { useBacheca } from '../store/bacheca';
import { BulletinHtml } from './BulletinHtml';

/**
 * Member-facing Bacheca feed. Used standalone on the Bacheca tab and embedded in
 * the admin Dashboard above "Assenti". Lists live messages addressed to the
 * caller, with an unread filter and an explicit "mark as read" action; body HTML
 * is server-sanitized so it renders safely. Keeps the tab-bar unread badge in
 * sync via the bacheca store.
 */
export function BachecaFeed({ title }: { title?: string }) {
  const { t } = useTranslation(['bacheca', 'common']);
  const setUnread = useBacheca((s) => s.setUnread);
  const [items, setItems] = useState<BulletinFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<BulletinFeedItem[]>('/api/v1/bulletins/me');
      setItems(r);
      setUnread(r.filter((i) => !i.read).length);
    } catch {
      /* keep stale data on transient failures */
    } finally {
      setLoading(false);
    }
  }, [setUnread]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        if (!cancelled) await load();
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  const unreadCount = useMemo(() => items.filter((i) => !i.read).length, [items]);
  const visible = unreadOnly ? items.filter((i) => !i.read) : items;

  const markRead = useCallback(
    async (id: string) => {
      setItems((prev) => {
        const next = prev.map((i) => (i.id === id ? { ...i, read: true } : i));
        setUnread(next.filter((i) => !i.read).length);
        return next;
      });
      try {
        await api(`/api/v1/bulletins/${id}/read`, { method: 'POST', json: {} });
      } catch {
        await load();
      }
    },
    [load, setUnread]
  );

  return (
    <View>
      <View style={styles.headerRow}>
        {title ? <Text style={styles.sectionTitle}>{title}</Text> : <View />}
        {items.length > 0 && (
          <View style={styles.seg}>
            <Pressable
              onPress={() => setUnreadOnly(false)}
              style={[styles.segBtn, !unreadOnly && styles.segBtnActive]}>
              <Text style={[styles.segText, !unreadOnly && styles.segTextActive]}>{t('all')}</Text>
            </Pressable>
            <Pressable
              onPress={() => setUnreadOnly(true)}
              style={[styles.segBtn, unreadOnly && styles.segBtnActive]}>
              <Text style={[styles.segText, unreadOnly && styles.segTextActive]}>
                {unreadCount > 0 ? t('unreadCount', { count: unreadCount }) : t('unreadOnly')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={color.primary} />
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="megaphone-outline" size={28} color={color.onSurfaceVariant} />
          <Text style={styles.empty}>{unreadOnly ? t('emptyUnread') : t('empty')}</Text>
        </View>
      ) : (
        visible.map((b) => <BulletinCard key={b.id} item={b} onMarkRead={() => markRead(b.id)} />)
      )}
    </View>
  );
}

function BulletinCard({
  item,
  onMarkRead,
}: {
  item: BulletinFeedItem;
  onMarkRead: () => void;
}) {
  const { t } = useTranslation(['bacheca', 'common']);
  return (
    <View style={[styles.card, !item.read && styles.cardUnread]}>
      <View style={styles.cardHead}>
        <View style={styles.titleWrap}>
          {!item.read && <View style={styles.dot} />}
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        </View>
        <Text style={styles.cardDate}>
          {fmtDate(item.created_at, { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </Text>
      </View>

      <BulletinHtml html={item.body_html} />

      <View style={styles.cardFoot}>
        {item.read ? (
          <View style={styles.readPill}>
            <Ionicons name="checkmark-done" size={14} color={color.success} />
            <Text style={styles.readPillText}>{t('read')}</Text>
          </View>
        ) : (
          <Pressable onPress={onMarkRead} style={styles.markBtn}>
            <Ionicons name="checkmark-done-outline" size={16} color={color.primary} />
            <Text style={styles.markBtnText}>{t('markRead')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: space.s2,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  seg: { flexDirection: 'row', backgroundColor: color.surfaceVariant, borderRadius: 10, padding: 2, gap: 2 },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  segBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: 'rgba(0,0,0,0.06)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  segText: { fontSize: 12, fontWeight: '600', color: color.onSurfaceVariant },
  segTextActive: { color: color.onSurface },

  centered: { paddingVertical: 32, alignItems: 'center' },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    shadowColor: 'rgba(0,0,0,0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 1,
  },
  cardUnread: { borderLeftColor: color.primary },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.primary },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: color.onSurface },
  cardDate: { fontSize: 12, color: color.onSurfaceVariant, fontVariant: ['tabular-nums'] },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  markBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: color.primaryContainer,
  },
  markBtnText: { fontSize: 13, fontWeight: '700', color: color.primary },
  readPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readPillText: { fontSize: 12, fontWeight: '700', color: color.success },

  emptyCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 28, alignItems: 'center', gap: 8 },
  empty: { color: color.onSurfaceVariant, textAlign: 'center' },
});
