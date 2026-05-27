import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color } from '@sonoqui/shared';
import type { StampEventType } from '@sonoqui/shared';
import { api } from '../lib/api';

type WorkState = 'nothing' | 'clocked_in' | 'on_break';

interface CurrentStateResponse {
  state: WorkState;
  lastEvent: StampEventType | null;
  lastEventAt: string | null;
}

interface WorkStateChipProps {
  state?: WorkState;
}

export function WorkStateChip({ state }: WorkStateChipProps) {
  const [fetched, setFetched] = useState<WorkState | null>(null);
  const value: WorkState = state ?? fetched ?? 'nothing';

  useEffect(() => {
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
  }, [state]);

  const meta = stateBadge(value);
  return (
    <View style={[styles.pill, { backgroundColor: meta.bg }]}>
      <View style={[styles.dot, { backgroundColor: meta.fg }]} />
      <Text style={[styles.text, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  );
}

function stateBadge(s: WorkState): { label: string; bg: string; fg: string } {
  if (s === 'clocked_in') return { label: 'Al lavoro', bg: '#e8f3ec', fg: color.success };
  if (s === 'on_break') return { label: 'In pausa', bg: '#fff3d1', fg: color.warning };
  return { label: 'Fuori servizio', bg: color.surfaceVariant, fg: color.onSurfaceVariant };
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
