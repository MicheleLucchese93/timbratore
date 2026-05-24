import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { color, radius, space, type as t } from './tokens.js';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  variant = 'primary',
  busy = false,
  disabled = false,
  onPress,
  style,
}: {
  label: string;
  variant?: ButtonVariant;
  busy?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const isDisabled = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        s.btnBase,
        variant === 'primary' ? s.btnPrimary : variant === 'secondary' ? s.btnSecondary : s.btnDanger,
        pressed && { opacity: 0.7 },
        isDisabled && { opacity: 0.5 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? color.onPrimary : color.onSurfaceVariant} />
      ) : (
        <Text
          style={[
            s.btnText,
            variant === 'primary' || variant === 'danger' ? { color: color.onPrimary } : { color: color.onSurfaceVariant },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Input(props: TextInputProps & { label?: string }) {
  const { label, ...rest } = props;
  return (
    <View style={{ marginBottom: space.s3 }}>
      {label && <Text style={s.label}>{label}</Text>}
      <TextInput
        placeholderTextColor={color.onSurfaceVariant}
        {...rest}
        style={[s.input, rest.style]}
      />
    </View>
  );
}

type BadgeTone = 'ok' | 'warn' | 'err' | 'muted';

export function Badge({ label, tone = 'muted' }: { label: string; tone?: BadgeTone }) {
  const palette: Record<BadgeTone, { bg: string; fg: string }> = {
    ok: { bg: color.successTint, fg: color.success },
    warn: { bg: color.warningTint, fg: color.warning },
    err: { bg: color.errorTint, fg: color.error },
    muted: { bg: color.surfaceVariant, fg: color.onSurfaceVariant },
  };
  const p = palette[tone];
  return (
    <View style={[s.badge, { backgroundColor: p.bg }]}>
      <Text style={[s.badgeText, { color: p.fg }]}>{label}</Text>
    </View>
  );
}

export function Heading({
  level = 'h1',
  children,
  style,
}: {
  level?: 'display' | 'h1' | 'h2';
  children: ReactNode;
  style?: TextStyle;
}) {
  const ts = t[level];
  return (
    <Text
      style={[
        { fontSize: ts.size, lineHeight: ts.line, fontWeight: ts.weight, color: color.onSurface },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

const s = StyleSheet.create({
  btnBase: {
    paddingVertical: space.s4,
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnPrimary: { backgroundColor: color.primary },
  btnSecondary: { backgroundColor: color.surfaceVariant },
  btnDanger: { backgroundColor: color.error },
  btnText: { fontSize: t.bodyStrong.size, lineHeight: t.bodyStrong.line, fontWeight: t.bodyStrong.weight },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: radius.lg,
    padding: space.s4,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  label: {
    fontSize: t.caption.size,
    fontWeight: t.caption.weight,
    color: color.onSurfaceVariant,
    marginBottom: space.s1,
  },
  input: {
    borderWidth: 1,
    borderColor: color.outline,
    borderRadius: radius.md,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
    fontSize: t.body.size,
    color: color.onSurface,
    backgroundColor: '#ffffff',
  },
  badge: {
    paddingHorizontal: space.s2,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: t.caption.size, fontWeight: t.caption.weight },
});
