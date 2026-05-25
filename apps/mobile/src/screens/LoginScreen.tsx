import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loginWithPassword } from '../lib/api';
import { useSession } from '../store/session';
import { color, space } from '@sonoqui/shared';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [emailFocus, setEmailFocus] = useState(false);
  const [pwdFocus, setPwdFocus] = useState(false);
  const [pwdVisible, setPwdVisible] = useState(false);
  const refresh = useSession((s) => s.refresh);

  async function submit() {
    if (busy) return;
    if (!email.trim()) {
      setErr("Inserisci l'email.");
      return;
    }
    if (!password) {
      setErr('Inserisci la password.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await loginWithPassword(email.trim().toLowerCase(), password);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Accesso fallito');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.brand}>
              ci<Text style={styles.brandAccent}>Sono</Text>
            </Text>
            <Text style={styles.subtitle}>
              Una timbratura semplice. Per chi c&apos;è.
            </Text>
          </View>

          <View style={styles.form}>
            {err ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{err}</Text>
              </View>
            ) : null}

            <View style={styles.fieldWrapper}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={[styles.input, emailFocus && styles.inputFocused]}
                value={email}
                onChangeText={setEmail}
                placeholder="email@azienda.it"
                placeholderTextColor={color.outline}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                autoComplete="email"
                onFocus={() => setEmailFocus(true)}
                onBlur={() => setEmailFocus(false)}
                editable={!busy}
              />
            </View>

            <View style={styles.fieldWrapper}>
              <Text style={styles.label}>Password</Text>
              <View style={[styles.inputShell, pwdFocus && styles.inputFocused]}>
                <TextInput
                  style={styles.inputInShell}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={color.outline}
                  secureTextEntry={!pwdVisible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  autoComplete="password"
                  onFocus={() => setPwdFocus(true)}
                  onBlur={() => setPwdFocus(false)}
                  editable={!busy}
                />
                <Pressable
                  onPress={() => setPwdVisible((v) => !v)}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={
                    pwdVisible ? 'Nascondi password' : 'Mostra password'
                  }
                  style={({ pressed }) => [
                    styles.toggle,
                    pressed && styles.togglePressed,
                  ]}
                >
                  <Text style={styles.toggleText}>
                    {pwdVisible ? 'Nascondi' : 'Mostra'}
                  </Text>
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={busy ? undefined : submit}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Accedi"
              style={({ pressed }) => [
                styles.cta,
                pressed && styles.ctaPressed,
                busy && styles.ctaBusy,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={color.onPrimary} />
              ) : (
                <Text style={styles.ctaText}>Accedi</Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Non hai un account? Contatta l&apos;amministratore della tua azienda.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: space.s5,
    paddingBottom: space.s8,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    paddingTop: space.s8,
    marginBottom: space.s6,
  },
  brand: {
    fontSize: 48,
    lineHeight: 56,
    fontWeight: '800',
    color: color.primary,
    letterSpacing: -1,
    textAlign: 'center',
  },
  brandAccent: { color: color.onPrimaryContainer },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: color.onSurfaceVariant,
    marginTop: space.s2,
    textAlign: 'center',
  },
  form: { marginBottom: space.s6 },
  fieldWrapper: { marginBottom: space.s4 },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: color.onSurfaceVariant,
    marginBottom: space.s2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#ffffff',
    color: color.onSurface,
    borderWidth: 1,
    borderColor: 'rgba(132,120,114,0.25)',
    borderRadius: 12,
    paddingHorizontal: space.s4,
    paddingVertical: 14,
    minHeight: 52,
    fontSize: 16,
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(132,120,114,0.25)',
    borderRadius: 12,
    paddingRight: space.s2,
    minHeight: 52,
  },
  inputInShell: {
    flex: 1,
    color: color.onSurface,
    paddingHorizontal: space.s4,
    paddingVertical: 14,
    fontSize: 16,
  },
  inputFocused: { borderColor: color.primary },
  toggle: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: 8,
  },
  togglePressed: { opacity: 0.6 },
  toggleText: { fontSize: 13, fontWeight: '600', color: color.primary },
  errorBanner: {
    backgroundColor: color.errorTint,
    borderRadius: 12,
    padding: space.s4,
    marginBottom: space.s4,
  },
  errorText: { fontSize: 14, color: color.error },
  cta: {
    marginTop: space.s5,
    backgroundColor: color.primary,
    paddingVertical: 16,
    paddingHorizontal: space.s5,
    borderRadius: 24,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(31,27,22,0.25)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 4,
  },
  ctaPressed: { opacity: 0.85 },
  ctaBusy: { opacity: 0.6 },
  ctaText: { fontSize: 16, fontWeight: '600', color: color.onPrimary },
  hint: {
    fontSize: 13,
    color: color.onSurfaceVariant,
    textAlign: 'center',
    paddingHorizontal: space.s4,
  },
});
