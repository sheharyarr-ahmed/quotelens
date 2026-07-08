import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { colors, radii, spacing, type as typography } from '@/lib/theme';

const RESEND_COOLDOWN_SECONDS = 60;

// Passwordless email OTP (SPEC.md v1.3 - Mobile UI/UX - Auth): signInWithOtp
// emails a 6-digit code, the user types it here, verifyOtp establishes the
// session. No deep links, no scheme/redirect configuration.
export default function LoginScreen() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Tick the resend cooldown one second at a time; each render re-arms a
  // single timeout, so cleanup on unmount is automatic.
  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendCode = async () => {
    setPending(true);
    setError(null);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setPending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setStep('code');
    setCode('');
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  const verifyCode = async () => {
    setPending(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    });
    if (verifyError) {
      setPending(false);
      setError(verifyError.message);
      return;
    }
    // Keep the button disabled while the auth gate swaps screens.
    router.replace('/');
  };

  const startOver = () => {
    setStep('email');
    setCode('');
    setError(null);
    setCooldown(0);
  };

  const canSend = !pending && email.trim().includes('@');
  const canVerify = !pending && code.length === 6;
  const canResend = !pending && cooldown <= 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.content}>
          <Text style={styles.brand}>QuoteLens</Text>

          {step === 'email' ? (
            <>
              <Text style={styles.heading}>Sign in</Text>
              <Text style={styles.subtitle}>
                Enter your email and we will send you a 6-digit sign-in code.
              </Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!pending}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={email}
              />
              {error !== null && <Text style={styles.error}>{error}</Text>}
              <Pressable
                accessibilityRole="button"
                disabled={!canSend}
                onPress={() => void sendCode()}
                style={[styles.button, !canSend && styles.buttonDisabled]}
              >
                {pending ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.buttonLabel}>Send code</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.heading}>Check your email</Text>
              <Text style={styles.subtitle}>
                We emailed a 6-digit code to {email.trim()}.
              </Text>
              <TextInput
                accessibilityLabel="6-digit code"
                autoComplete="one-time-code"
                editable={!pending}
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={(text) => setCode(text.replace(/[^0-9]/g, ''))}
                placeholder="000000"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.codeInput]}
                textContentType="oneTimeCode"
                value={code}
              />
              {error !== null && <Text style={styles.error}>{error}</Text>}
              <Pressable
                accessibilityRole="button"
                disabled={!canVerify}
                onPress={() => void verifyCode()}
                style={[styles.button, !canVerify && styles.buttonDisabled]}
              >
                {pending ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.buttonLabel}>Verify</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!canResend}
                onPress={() => void sendCode()}
                style={styles.linkRow}
              >
                <Text style={canResend ? styles.link : styles.linkDisabled}>
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={pending}
                onPress={startOver}
                style={styles.linkRow}
              >
                <Text style={styles.link}>Use a different email</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: {
    ...typography.title,
    color: colors.primary,
    marginBottom: spacing.xxl,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 52,
    paddingVertical: spacing.md,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { ...typography.bodyBold, color: colors.textOnPrimary },
  codeInput: {
    ...typography.title,
    fontVariant: ['tabular-nums'],
    letterSpacing: spacing.sm,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  flex: { flex: 1 },
  heading: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  link: { ...typography.bodyBold, color: colors.primary },
  linkDisabled: { ...typography.bodyBold, color: colors.textMuted },
  linkRow: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
