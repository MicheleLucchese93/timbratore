import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { color } from '@sonoqui/shared';
import type { StampEventType } from '@sonoqui/shared';
import { api } from '../lib/api';

type WorkState = 'nothing' | 'clocked_in' | 'on_break' | 'on_lunch';

interface CurrentStateResponse {
  state: WorkState;
  lastEvent: StampEventType | null;
  lastEventAt: string | null;
}

interface WorkStateChipProps {
  state?: WorkState;
}

export function WorkStateChip({ state }: WorkStateChipProps) {
  const { t } = useTranslation(['components', 'common']);
  const [fetched, setFetched] = useState<WorkState | null>(null);
  const value: WorkState = state ?? fetched ?? 'nothing';

  useFocusEffect(
    useCallback(() => {
      if (state !== undefined) return;
      let cancelled = false;
      api<CurrentStateResponse>('/api/v1/stamps/me/current-state')
        .then((r) => {
          if (!cancelled) setFetched(r.state);
        })
        .catch(() => {
          /* ignore */
        });
      return () => {
        cancelled = true;
      };
    }, [state]),
  );

  const meta = stateBadge(value);
  return (
    <View style={[styles.pill, { backgroundColor: meta.bg }]}>
      <View style={[styles.dot, { backgroundColor: meta.fg }]} />
      <Text style={[styles.text, { color: meta.fg }]}>{t(meta.labelKey)}</Text>
    </View>
  );
}

function stateBadge(s: WorkState): { labelKey: string; bg: string; fg: string } {
  if (s === 'clocked_in') return { labelKey: 'common:workState.working', bg: '#e8f3ec', fg: color.success };
  if (s === 'on_break') return { labelKey: 'common:workState.on_break', bg: '#fff3d1', fg: color.warning };
  if (s === 'on_lunch') return { labelKey: 'common:workState.on_lunch', bg: '#fff3d1', fg: color.warning };
  return { labelKey: 'common:workState.off', bg: color.surfaceVariant, fg: color.onSurfaceVariant };
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
});
