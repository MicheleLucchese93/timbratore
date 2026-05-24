import { useState } from 'react';
import { Alert, View, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, setToken } from '../lib/api';
import { useSession } from '../store/session';
import { Button, Card, Heading, Input } from '@cisono/shared/src/design/native';
import { color, space } from '@cisono/shared';

export function LoginScreen() {
  const [email, setEmail] = useState('mario.rossi@demo.cisono.local');
  const [busy, setBusy] = useState(false);
  const refresh = useSession((s) => s.refresh);

  async function login() {
    setBusy(true);
    try {
      const r = await api<{ token: string }>('/api/v1/auth/dev-token', {
        method: 'POST',
        json: { email },
      });
      await setToken(r.token);
      await refresh();
    } catch (err) {
      if (Platform.OS === 'web') {
        // eslint-disable-next-line no-alert
        window.alert(`Accesso fallito: ${(err as Error).message}`);
      } else {
        Alert.alert('Accesso fallito', (err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Heading level="display" style={{ marginBottom: 4, color: color.primary }}>
          ciSono
        </Heading>
        <Heading level="h2" style={{ color: color.onSurfaceVariant, marginBottom: space.s6 }}>
          Accedi alla tua azienda
        </Heading>
        <Card>
          <Input
            label="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="email@azienda.it"
          />
          <Button label="Accedi" busy={busy} onPress={login} />
        </Card>
        <View style={{ marginTop: space.s4 }}>
          <Heading level="h2" style={{ fontSize: 12, color: color.onSurfaceVariant }}>
            Modalità sviluppo — JWT emesso direttamente.
          </Heading>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  container: { padding: space.s5, paddingTop: space.s6, flex: 1 },
});
