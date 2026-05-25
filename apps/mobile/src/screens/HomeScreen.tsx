import { useEffect, useState, useCallback } from 'react';
import { View, Text, ActivityIndicator, Alert, StyleSheet, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../store/session';
import { api } from '../lib/api';
import { acquireLocation } from '../lib/acquire-location';
import { enqueueStamp, drainQueue } from '../lib/offline-queue';
import { stateFromLastEvent } from '@sonoqui/shared';
import type { StampEventType } from '@sonoqui/shared';
import { Badge, Button, Card, Heading } from '@sonoqui/shared/src/design/native';
import { color, space } from '@sonoqui/shared';

interface CurrentState {
  state: 'nothing' | 'clocked_in' | 'on_break';
  lastEvent: StampEventType | null;
  lastEventAt: string | null;
}

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function alertCross(title: string, msg: string): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${msg}`);
  } else {
    Alert.alert(title, msg);
  }
}

export function HomeScreen() {
  const { me, logout } = useSession();
  const [state, setState] = useState<CurrentState | null>(null);
  const [working, setWorking] = useState(false);
  const [lastSubmittedAt, setLastSubmittedAt] = useState<Date | null>(null);
  const [lastUndoId, setLastUndoId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api<CurrentState>('/api/v1/stamps/me/current-state');
      setState(s);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
    drainQueue().catch(() => {});
  }, [refresh]);

  async function stamp(event: StampEventType) {
    if (working) return;
    setWorking(true);
    const idem = uuidv4();
    const now = new Date();
    let payload: Record<string, unknown> = {
      event_type: event,
      occurred_at: now.toISOString(),
      device_platform: Platform.OS,
      device_app_version: '0.1.0',
    };
    try {
      const branch = me?.branches[0];
      if (!branch?.smart_working) {
        const loc = await acquireLocation();
        payload = {
          ...payload,
          latitude: loc.latitude,
          longitude: loc.longitude,
          gps_accuracy_m: loc.accuracyM,
          is_mock_location: loc.isMockLocation,
        };
      }
      try {
        const stamp = await api<{ id: string }>('/api/v1/stamps', {
          method: 'POST',
          headers: { 'Idempotency-Key': idem },
          json: payload,
        });
        setLastSubmittedAt(now);
        setLastUndoId(stamp.id);
        await refresh();
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (!e.code || e.code === 'NETWORK' || e.message?.includes('Network')) {
          enqueueStamp(idem, payload);
          alertCross('Senza connessione', 'Timbratura accodata. Verrà inviata quando torni online.');
        } else {
          alertCross('Timbratura non riuscita', humanError(e));
        }
      }
    } catch (err) {
      alertCross('Posizione GPS', humanError(err));
    } finally {
      setWorking(false);
    }
  }

  async function undo() {
    if (!lastUndoId) return;
    try {
      await api(`/api/v1/stamps/${lastUndoId}`, { method: 'DELETE' });
      setLastUndoId(null);
      setLastSubmittedAt(null);
      await refresh();
    } catch (err) {
      alertCross('Impossibile annullare', humanError(err));
    }
  }

  if (!me) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const branch = me.branches[0];
  const currentState = state?.state ?? stateFromLastEvent(null);
  const buttons: Array<{ event: StampEventType; label: string; variant: 'primary' | 'secondary' }> = [];
  if (currentState === 'nothing') {
    buttons.push({ event: 'clock_in', label: 'Timbra ingresso', variant: 'primary' });
  } else if (currentState === 'clocked_in') {
    buttons.push({ event: 'clock_out', label: 'Timbra uscita', variant: 'primary' });
    buttons.push({ event: 'break_start', label: 'Inizia pausa', variant: 'secondary' });
  } else if (currentState === 'on_break') {
    buttons.push({ event: 'break_end', label: 'Termina pausa', variant: 'primary' });
  }
  const undoVisible =
    lastUndoId && lastSubmittedAt && Date.now() - lastSubmittedAt.getTime() < 60_000;
  const stateTone = currentState === 'clocked_in' ? 'ok' : currentState === 'on_break' ? 'warn' : 'muted';
  const stateLabel = currentState === 'clocked_in' ? 'Al lavoro' : currentState === 'on_break' ? 'In pausa' : 'Fuori servizio';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <View>
            <Heading level="h1">{me.tenant.ragione_sociale}</Heading>
            {branch && (
              <Text style={styles.branchLine}>{branch.name}</Text>
            )}
          </View>
          <Button label="Esci" variant="secondary" onPress={() => { logout(); }} />
        </View>
        <View style={{ marginVertical: space.s4 }}>
          <Badge label={stateLabel} tone={stateTone} />
        </View>
        {buttons.map((b) => (
          <View key={b.event} style={{ marginBottom: space.s3 }}>
            <Button
              label={b.label}
              variant={b.variant}
              busy={working}
              onPress={() => {
                stamp(b.event);
              }}
            />
          </View>
        ))}
        {undoVisible && (
          <View style={{ marginTop: space.s4 }}>
            <Button label="Annulla ultima timbratura" variant="danger" onPress={undo} />
          </View>
        )}
        {state?.lastEventAt && (
          <Text style={styles.lastLine}>
            Ultimo evento: {humanEvent(state.lastEvent)} alle {formatTime(state.lastEventAt)}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function humanEvent(e: StampEventType | null): string {
  switch (e) {
    case 'clock_in': return 'Ingresso';
    case 'clock_out': return 'Uscita';
    case 'break_start': return 'Inizio pausa';
    case 'break_end': return 'Fine pausa';
    default: return '–';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function humanError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case 'OUT_OF_GEOFENCE': return 'Sei fuori dall\'area consentita.';
    case 'INVALID_TRANSITION': return 'Operazione non valida per lo stato attuale.';
    case 'DUPLICATE_TOO_FAST': return 'Hai già timbrato pochi secondi fa.';
    case 'GPS_ACCURACY_TOO_LOW': return 'Il segnale GPS è troppo debole.';
    case 'GPS_REQUIRED': return 'Serve il GPS per timbrare.';
    case 'MOCK_LOCATION_BLOCKED': return 'Posizione finta non consentita.';
    case 'LOCATION_PERMISSION_DENIED': return 'Permesso posizione negato. Vai alle Impostazioni.';
    case 'ACQUISITION_TIMEOUT': return 'GPS non disponibile. Spostati all\'aperto e riprova.';
    case 'WEB_CLOCK_IN_DISABLED': return 'Timbratura da web non consentita per questo utente.';
    default: return e.message ?? 'Errore sconosciuto.';
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  scroll: { padding: space.s5, paddingTop: space.s6 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.s3 },
  branchLine: { color: color.onSurfaceVariant, marginTop: 2 },
  lastLine: { color: color.onSurfaceVariant, marginTop: space.s5, fontSize: 12 },
});
