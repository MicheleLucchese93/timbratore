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
import { router } from 'expo-router';
import { Trans, useTranslation } from 'react-i18next';
import { color, space } from '@sonoqui/shared';
import { recoverPassword } from '../lib/api';

export function ForgotPasswordScreen() {
  const { t } = useTranslation(['forgotPassword', 'common']);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailFocus, setEmailFocus] = useState(false);

  async function submit() {
    if (busy) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setBusy(true);
    try {
      await recoverPassword(trimmed);
    } catch {
      // Backend always returns 200 (email-enumeration protection). Even on
      // transport error we still show "sent" so the UI never reveals account
      // existence — mirrors Penno's PasswordResetScreen behaviour.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
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
              sono<Text style={styles.brandAccent}>Qui</Text>
            </Text>
            <Text style={styles.subtitle}>{t('subtitle')}</Text>
          </View>

          {sent ? (
            <View>
              <View style={styles.successBanner}>
                <Text style={styles.successTitle}>{t('success.title')}</Text>
                <Text style={styles.successBody}>
                  <Trans
                    i18nKey="forgotPassword:success.bodyRegistered"
                    values={{ email: email.trim() }}
                    components={{ 0: <Text style={styles.emailHighlight} /> }}
                  />
                </Text>
              </View>
              <Pressable
                onPress={back}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.cta,
                  pressed && styles.ctaPressed,
                ]}
              >
                <Text style={styles.ctaText}>{t('backToLogin')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.instructions}>
                Inserisci la tua email. Ti invieremo un link per reimpostare la
                password.
              </Text>

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

              <Pressable
                onPress={busy ? undefined : submit}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Invia link di reset"
                style={({ pressed }) => [
                  styles.cta,
                  pressed && styles.ctaPressed,
                  busy && styles.ctaBusy,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={color.onPrimary} />
                ) : (
                  <Text style={styles.ctaText}>Invia link di reset</Text>
                )}
              </Pressable>

              <Pressable
                onPress={back}
                hitSlop={8}
                accessibilityRole="link"
                style={({ pressed }) => [
                  styles.backLink,
                  pressed && styles.backLinkPressed,
                ]}
              >
                <Text style={styles.backLinkText}>Torna al login</Text>
              </Pressable>
            </View>
          )}
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
  instructions: {
    fontSize: 14,
    lineHeight: 22,
    color: color.onSurfaceVariant,
    marginBottom: space.s5,
    textAlign: 'center',
  },
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
  inputFocused: { borderColor: color.primary },
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
  backLink: {
    alignSelf: 'center',
    marginTop: space.s4,
    padding: space.s2,
  },
  backLinkPressed: { opacity: 0.6 },
  backLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: color.primary,
  },
  successBanner: {
    backgroundColor: '#e8f3ec',
    borderRadius: 16,
    padding: space.s5,
    marginBottom: space.s4,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: color.onSurface,
    marginBottom: space.s2,
  },
  successBody: {
    fontSize: 14,
    lineHeight: 22,
    color: color.onSurfaceVariant,
  },
  emailHighlight: { color: color.primary, fontWeight: '600' },
});
