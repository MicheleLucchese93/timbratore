import { useState } from 'react';
import { Alert, View, StyleSheet, Platform, KeyboardAvoidingView, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loginWithPassword } from '../lib/api';
import { useSession } from '../store/session';
import { Button, Card, Heading, Input } from '@cisono/shared/src/design/native';
import { color, space } from '@cisono/shared';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refresh = useSession((s) => s.refresh);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await loginWithPassword(email.trim().toLowerCase(), password);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Accesso fallito';
      if (Platform.OS === 'web') {
        setErr(msg);
      } else {
        Alert.alert('Accesso fallito', msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Heading level="display" style={{ color: color.primary, marginBottom: 4 }}>ciSono</Heading>
            <Text style={styles.tagline}>Una timbratura semplice. Per chi c'è.</Text>
          </View>
          <Card>
            <Input
              label="Email"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              placeholder="email@azienda.it"
            />
            <Input
              label="Password"
              autoCapitalize="none"
              secureTextEntry
              textContentType="password"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
            />
            {err && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{err}</Text>
              </View>
            )}
            <Button label={busy ? 'Accesso in corso…' : 'Accedi'} busy={busy} onPress={submit} />
          </Card>
          <Text style={styles.hint}>
            Non hai un account? Contatta l'amministratore della tua azienda.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  scroll: { padding: space.s5, paddingTop: space.s8, flexGrow: 1, gap: space.s5 },
  hero: { alignItems: 'center', marginBottom: space.s4 },
  tagline: { color: color.onSurfaceVariant, fontSize: 14, textAlign: 'center' },
  errorBox: {
    backgroundColor: '#fde4e4',
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: 8,
    marginBottom: space.s3,
  },
  errorText: { color: color.error, fontSize: 13 },
  hint: { color: color.onSurfaceVariant, fontSize: 12, textAlign: 'center' },
});
