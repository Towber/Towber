import React, { useState } from 'react';
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
import * as Linking from 'expo-linking';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../../src/api';
import { colors, font, radius } from '../../src/theme';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [sendingLink, setSendingLink] = useState(false);
  const [startingGuest, setStartingGuest] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendMagicLink = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    setSendingLink(true);
    setError(null);
    setSentTo(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: Linking.createURL('auth/callback'),
          shouldCreateUser: false,
        },
      });
      if (signInError) throw signInError;
      setSentTo(normalizedEmail);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the sign-in link. Try again.');
    } finally {
      setSendingLink(false);
    }
  };

  const continueAsClient = async () => {
    setStartingGuest(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError) throw signInError;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start a guest session.');
    } finally {
      setStartingGuest(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>T</Text></View>
          <Text style={styles.brand}>TOWBER</Text>
          <Text style={styles.title}>Welcome to Towber</Text>
          <Text style={styles.subtitle}>
            Drivers: use the email address invited by Towber. Clients can continue as a guest.
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>Email address</Text>
            <TextInput
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={(value) => { setEmail(value); setError(null); setSentTo(null); }}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              returnKeyType="send"
              style={styles.input}
              value={email}
              onSubmitEditing={() => { void sendMagicLink(); }}
            />
            <Pressable
              accessibilityRole="button"
              disabled={sendingLink || startingGuest}
              onPress={() => { void sendMagicLink(); }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (sendingLink || startingGuest) && styles.disabled]}
            >
              {sendingLink ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.primaryButtonText}>Email me a sign-in link</Text>}
            </Pressable>
            <Text style={styles.helper}>Only an account already invited to Towber can sign in with email.</Text>
          </View>

          {sentTo ? (
            <View accessibilityLiveRegion="polite" style={styles.notice}>
              <Text style={styles.noticeTitle}>Check your email</Text>
              <Text style={styles.noticeText}>We sent a one-time link to {sentTo}. Open it on this phone to return to Towber.</Text>
            </View>
          ) : null}

          {error ? (
            <View accessibilityLiveRegion="polite" style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              {error.toLowerCase().includes('anonymous sign-ins are disabled') ? (
                <Text style={styles.errorHint}>Enable Anonymous Sign-Ins under Supabase Authentication providers, or use your invited email.</Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>OR</Text><View style={styles.dividerLine} /></View>

          <Pressable
            accessibilityRole="button"
            disabled={sendingLink || startingGuest}
            onPress={() => { void continueAsClient(); }}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryPressed, (sendingLink || startingGuest) && styles.disabled]}
          >
            {startingGuest ? <ActivityIndicator color={colors.go} /> : <Text style={styles.secondaryButtonText}>Continue as a client guest</Text>}
          </Pressable>
          <Text style={styles.footer}>Guest sessions are temporary and can’t be recovered after signing out or reinstalling the app.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 36 },
  brandMark: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.go, marginBottom: 12 },
  brandMarkText: { color: colors.bg, fontFamily: font.bold, fontSize: 29, lineHeight: 34 },
  brand: { color: colors.go, fontFamily: font.bold, fontSize: 12, letterSpacing: 2.5, marginBottom: 22 },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 28, lineHeight: 35 },
  subtitle: { color: colors.textMuted, fontFamily: font.regular, fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 30 },
  form: { gap: 10 },
  label: { color: colors.text, fontFamily: font.semibold, fontSize: 13 },
  input: { height: 54, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface, paddingHorizontal: 16, color: colors.text, fontFamily: font.regular, fontSize: 15 },
  primaryButton: { minHeight: 54, borderRadius: 16, backgroundColor: colors.go, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 6 },
  primaryButtonText: { color: colors.bg, fontFamily: font.bold, fontSize: 15 },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.6 },
  helper: { color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 18, marginTop: 2 },
  notice: { padding: 14, marginTop: 18, borderRadius: radius.card, borderColor: 'rgba(0,230,118,0.35)', borderWidth: 1, backgroundColor: 'rgba(0,230,118,0.08)', gap: 4 },
  noticeTitle: { color: colors.go, fontFamily: font.semibold, fontSize: 14 },
  noticeText: { color: colors.text, fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  errorBox: { padding: 14, marginTop: 16, borderRadius: radius.card, borderColor: 'rgba(244,63,94,0.4)', borderWidth: 1, backgroundColor: 'rgba(244,63,94,0.08)', gap: 6 },
  errorText: { color: colors.text, fontFamily: font.medium, fontSize: 13, lineHeight: 19 },
  errorHint: { color: colors.warn, fontFamily: font.regular, fontSize: 12, lineHeight: 18 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 22 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textMuted, fontFamily: font.semibold, fontSize: 11, letterSpacing: 1 },
  secondaryButton: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  secondaryPressed: { backgroundColor: colors.surfaceRaised },
  secondaryButtonText: { color: colors.text, fontFamily: font.semibold, fontSize: 14 },
  footer: { color: colors.textMuted, fontFamily: font.regular, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 18 },
});
