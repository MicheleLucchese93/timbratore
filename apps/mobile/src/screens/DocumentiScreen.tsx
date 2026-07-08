import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { DocumentCategory, DocumentListItem } from '@sonoqui/shared';
import { color, space, type as ty } from '@sonoqui/shared';
import { api } from '../lib/api';
import { EmptyState } from '../components/EmptyState';
import { authenticate, getBiometricCapability } from '../lib/biometric';
import { AppHeader } from '../components/AppHeader';
import { fmtDate } from '../i18n/format';

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
};

const CATEGORY_ICON: Record<DocumentCategory, keyof typeof Ionicons.glyphMap> = {
  cedolino: 'cash-outline',
  cu: 'receipt-outline',
  contratto: 'document-text-outline',
  comunicazione: 'mail-outline',
  altro: 'folder-outline',
};

// Three biometric-gate states: still checking the OS capability / running the
// prompt (`checking`), unlocked for this focus session (`unlocked`), or no
// biometric AND no device passcode is enrolled so the section can't be opened
// (`blocked`). A plain `false` "locked" state shows the retry CTA.
type GateState = 'checking' | 'locked' | 'unlocked' | 'blocked';

export function DocumentiScreen() {
  const { t } = useTranslation(['documenti', 'common']);

  // --- Mandatory biometric gate (independent of the global app-lock toggle).
  // Re-locks on every blur and re-auths on every focus.
  const [gate, setGate] = useState<GateState>('checking');
  const [bioLabel, setBioLabel] = useState('biometria');
  const promptingRef = useRef(false);

  const runGate = useCallback(async () => {
    if (promptingRef.current) return;
    promptingRef.current = true;
    setGate('checking');
    try {
      const cap = await getBiometricCapability();
      setBioLabel(cap.label);
      // expo-local-authentication falls back to the device passcode
      // automatically when no biometric is enrolled; on web (Playwright)
      // authenticate() resolves true. So we always try the prompt first and
      // only declare "blocked" below when it fails AND there's no unlock method.
      const ok = await authenticate(t('lock.unlockWith', { label: cap.label }));
      if (ok) {
        setGate('unlocked');
      } else {
        // A failed/cancelled prompt on a device that has SOME unlock method
        // stays "locked" (retry CTA). If the device genuinely has no biometric
        // and no passcode, expo returns success:false too — surface the
        // blocking message so the user understands why they're stuck.
        setGate(!cap.available && !cap.hasHardware ? 'blocked' : 'locked');
      }
    } catch {
      setGate('locked');
    } finally {
      promptingRef.current = false;
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void runGate();
      // Re-lock when the screen loses focus so it re-auths on the next open.
      return () => {
        promptingRef.current = false;
        setGate('checking');
      };
    }, [runGate])
  );

  // --- Document list state.
  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<DocumentListItem[]>('/api/v1/documents/me');
      setDocs(list);
    } catch {
      /* ignore — keep last list */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load only after the gate is unlocked, and refresh on each unlock.
  useFocusEffect(
    useCallback(() => {
      if (gate !== 'unlocked') return;
      setLoading(true);
      void load();
    }, [gate, load])
  );

  async function openDoc(doc: DocumentListItem) {
    if (opening) return;
    setOpening(doc.id);
    try {
      // Hitting the download endpoint records the view server-side (for the
      // owning employee). The presigned URL is short-lived (60s).
      const { url } = await api<{ url: string; expires_in: number }>(
        `/api/v1/documents/${doc.id}/download`
      );
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') window.open(url, '_blank');
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
      // Optimistically mark as viewed so the indicator updates without a refetch.
      setDocs((prev) =>
        prev.map((d) =>
          d.id === doc.id && d.viewed_at == null
            ? { ...d, viewed_at: new Date().toISOString() }
            : d
        )
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('openError');
      if (Platform.OS === 'web') window.alert(msg || t('openError'));
      else Alert.alert(t('common:state.error'), t('openError'));
    } finally {
      setOpening(null);
    }
  }

  // --- Gate renders.
  if (gate !== 'unlocked') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.lockCenter}>
          <Ionicons
            name={gate === 'blocked' ? 'lock-closed-outline' : 'document-lock-outline'}
            size={40}
            color={color.primary}
            style={styles.lockIcon}
          />
          {gate === 'checking' ? (
            <>
              <ActivityIndicator color={color.primary} />
              <Text style={styles.lockSubtitle}>{t('lock.checking')}</Text>
            </>
          ) : gate === 'blocked' ? (
            <>
              <Text style={styles.lockTitle}>{t('lock.unavailableTitle')}</Text>
              <Text style={styles.lockSubtitle}>{t('lock.unavailable')}</Text>
            </>
          ) : (
            <>
              <Text style={styles.lockTitle}>{t('title')}</Text>
              <Text style={styles.lockSubtitle}>{t('lock.subtitle')}</Text>
              <Pressable
                onPress={() => void runGate()}
                accessibilityRole="button"
                accessibilityLabel={t('lock.unlockWith', { label: bioLabel })}
                style={({ pressed }) => [styles.lockCta, pressed && styles.lockCtaPressed]}>
                <View style={styles.lockCtaInner}>
                  <Ionicons name="finger-print-outline" size={20} color={color.onPrimary} />
                  <Text style={styles.lockCtaText}>
                    {t('lock.unlockWith', { label: bioLabel })}
                  </Text>
                </View>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // --- Unlocked: the document list.
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }>
        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}

        {!loading && docs.length === 0 && (
          <EmptyState
            icon="folder-open-outline"
            title={t('empty.title')}
            subtitle={t('empty.sub')}
            fill
            bare
          />
        )}

        {docs.map((doc) => (
          <DocumentCard
            key={doc.id}
            doc={doc}
            busy={opening === doc.id}
            onPress={() => void openDoc(doc)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function DocumentCard({
  doc,
  busy,
  onPress,
}: {
  doc: DocumentListItem;
  busy: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation(['documenti', 'common']);
  const isViewed = doc.viewed_at != null;
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={doc.title}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.catIcon}>
        <Ionicons name={CATEGORY_ICON[doc.category]} size={20} color={color.primary} />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.catLabel}>{t(`category.${doc.category}`)}</Text>
          <View
            style={[styles.statusPill, isViewed ? styles.statusViewed : styles.statusUnread]}>
            <Text
              style={[
                styles.statusPillText,
                { color: isViewed ? color.success : color.warning },
              ]}>
              {isViewed ? t('viewed') : t('notViewed')}
            </Text>
          </View>
        </View>
        <Text style={styles.docTitle} numberOfLines={2}>
          {doc.title}
        </Text>
        <Text style={styles.docMeta}>
          {t('uploadedAt', { date: fmtDate(doc.created_at, DATE_OPTS) })}
        </Text>
        {doc.viewed_at && (
          <Text style={styles.docMeta}>
            {t('viewedAt', { date: fmtDate(doc.viewed_at, DATE_OPTS) })}
          </Text>
        )}
        <Text style={styles.docMetaFaint}>
          {t('retentionUntil', { date: fmtDate(doc.retention_until, DATE_OPTS) })}
        </Text>
      </View>
      <View style={styles.cardAction}>
        {busy ? (
          <ActivityIndicator color={color.primary} />
        ) : (
          <Ionicons name="download-outline" size={22} color={color.primary} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 6, paddingBottom: 96 },

  pageTitle: {
    fontSize: ty.h2.size,
    lineHeight: ty.h2.line,
    fontWeight: '700',
    color: color.onSurface,
    paddingHorizontal: 6,
    marginTop: space.s2,
  },
  pageSubtitle: {
    fontSize: 13,
    color: color.onSurfaceVariant,
    paddingHorizontal: 6,
    marginTop: 2,
    marginBottom: space.s3,
  },

  centered: { paddingVertical: 48, alignItems: 'center' },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 14,
    marginBottom: space.s3,
    shadowColor: 'rgba(0,0,0,0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 1,
  },
  cardPressed: { opacity: 0.8 },
  catIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  catLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusViewed: { backgroundColor: color.successTint },
  statusUnread: { backgroundColor: color.warningTint },
  statusPillText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  docTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: color.onSurface,
    marginTop: 4,
  },
  docMeta: { fontSize: 12, color: color.onSurfaceVariant, marginTop: 4 },
  docMetaFaint: { fontSize: 11, color: color.onSurfaceVariant, marginTop: 1, opacity: 0.8 },
  cardAction: { width: 32, alignItems: 'center', justifyContent: 'center' },

  // Lock gate.
  lockCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s5,
  },
  lockIcon: { marginBottom: space.s3 },
  lockTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: color.onSurface,
    textAlign: 'center',
  },
  lockSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: color.onSurfaceVariant,
    marginTop: space.s2,
    marginBottom: space.s6,
    textAlign: 'center',
  },
  lockCta: {
    backgroundColor: color.primary,
    paddingVertical: 16,
    paddingHorizontal: space.s6,
    borderRadius: 24,
    minHeight: 52,
    minWidth: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockCtaPressed: { opacity: 0.85 },
  lockCtaInner: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  lockCtaText: { fontSize: 16, fontWeight: '600', color: color.onPrimary },
});
