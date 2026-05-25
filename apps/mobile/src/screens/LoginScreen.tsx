import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiBaseUrl, loginWithPassword } from '../lib/api';
import { useSession } from '../store/session';
import { color, space } from '@sonoqui/shared';

const LOGO = require('../../assets/images/icon.png');

function forgotPasswordUrl(): string {
  // Mobile points at `api-<env>.xdevapp.it`; the web admin lives at
  // `app-<env>.xdevapp.it`. Swap the host prefix and append `/forgot-password`.
  try {
    const u = new URL(apiBaseUrl());
    u.hostname = u.hostname.replace(/^api-/, 'app-');
    u.pathname = '/forgot-password';
    return u.toString();
  } catch {
    return 'https://app-sonoqui.xdevapp.it/forgot-password';
  }
}

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [emailFocus, setEmailFocus] = useState(false);
  const [pwdFocus, setPwdFocus] = useState(false);
  const [pwdVisible, setPwdVisible] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const refresh = useSession((s) => s.refresh);

  // `keyboardWillShow`/`Hide` fire in lockstep with the iOS keyboard's own
  // animation, so the brand block disappears and the form slides up in a
  // single coordinated pass — no double-jump. On Android only the `Did`
  // events are available, which is fine because Android resizes the layout
  // instantly.
  useEffect(() => {
    const showEvt =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, () =>
      setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(hideEvt, () =>
      setKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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

  async function openForgot() {
    try {
      await Linking.openURL(forgotPasswordUrl());
    } catch {
      /* swallow — best-effort deep link */
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
          {/* Header: logo + brand stay rendered, but the logo + subtitle hide
              while the keyboard is up so the form keeps a comfortable focal
              centre instead of being squeezed against the top safe-area. */}
          <View style={styles.header}>
            {!keyboardVisible ? (
              <Image
                source={LOGO}
                style={styles.logo}
                resizeMode="contain"
                accessible={false}
              />
            ) : null}
            <Text style={styles.brand}>
              sono<Text style={styles.brandAccent}>Qui</Text>
            </Text>
            {!keyboardVisible ? (
              <Text style={styles.subtitle}>
                Il tempo che lavori, semplice come dirlo.
              </Text>
            ) : null}
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
              <View style={styles.labelRow}>
                <Text style={styles.label}>Password</Text>
                <Pressable
                  onPress={openForgot}
                  hitSlop={8}
                  accessibilityRole="link"
                  accessibilityLabel="Password dimenticata"
                  style={({ pressed }) => [pressed && styles.forgotPressed]}
                >
                  <Text style={styles.forgotText}>Password dimenticata?</Text>
                </Pressable>
              </View>
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

          {!keyboardVisible ? (
            <Text style={styles.hint}>
              Non hai un account? Contatta l&apos;amministratore della tua azienda.
            </Text>
          ) : null}
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
  logo: {
    width: 84,
    height: 84,
    marginBottom: space.s3,
    // Same background as the screen — icon PNG already has its own padding,
    // so we don't tint it. Setting `backgroundColor` to `color.surface` keeps
    // the rendered tile flush with the safe-area background even on devices
    // that render transparent PNGs against the system window colour.
    backgroundColor: color.surface,
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
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  forgotText: {
    fontSize: 12,
    fontWeight: '600',
    color: color.primary,
    marginBottom: space.s2,
  },
  forgotPressed: { opacity: 0.6 },
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
