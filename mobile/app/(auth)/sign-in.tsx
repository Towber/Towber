import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { font } from '../../src/theme';

const SCREEN_BG = '#0F172A';
const ACCENT = '#10B981';
const TEXT = '#F8FAFC';
const MUTED = '#94A3B8';
const GLASS_BORDER = 'rgba(148,163,184,0.18)';

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

  const actionsDisabled = sendingLink || startingGuest;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Image
              accessible
              accessibilityLabel="Towber logo"
              resizeMode="contain"
              source={require('../../assets/icon.png')}
              style={styles.logo}
            />
            <Text style={styles.brand}>TOWBER</Text>
            <Text style={styles.title}>Welcome to Towber</Text>
            <Text style={styles.subtitle}>
              Drivers: sign in with the email invited by Towber. Clients can get help right away as a guest.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={actionsDisabled}
            onPress={() => { void continueAsClient(); }}
            style={({ pressed }) => [styles.guestButton, pressed && styles.guestPressed, actionsDisabled && styles.disabled]}
          >
            <View style={styles.guestCopy}>
              <Text style={styles.guestButtonText}>Continue as a client guest</Text>
              <Text style={styles.guestButtonSubtext}>No account needed to request help</Text>
            </View>
            {startingGuest ? (
              <ActivityIndicator color={SCREEN_BG} />
            ) : (
              <View style={styles.guestArrow}><Text style={styles.guestArrowText}>›</Text></View>
            )}
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR SIGN IN WITH EMAIL</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.formCard}>
            <Text style={styles.label}>Email address</Text>
            <TextInput
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={(value) => { setEmail(value); setError(null); setSentTo(null); }}
              placeholder="you@example.com"
              placeholderTextColor={MUTED}
              returnKeyType="send"
              style={styles.input}
              value={email}
              onSubmitEditing={() => { void sendMagicLink(); }}
            />
            <Pressable
              accessibilityRole="button"
              disabled={actionsDisabled}
              onPress={() => { void sendMagicLink(); }}
              style={({ pressed }) => [styles.emailButton, pressed && styles.emailPressed, actionsDisabled && styles.disabled]}
            >
              {sendingLink ? (
                <ActivityIndicator color={ACCENT} />
              ) : (
                <Text style={styles.emailButtonText}>Email me a sign-in link</Text>
              )}
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

          <Text style={styles.footer}>Guest sessions are temporary and can’t be recovered after signing out or reinstalling the app.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: SCREEN_BG },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: 28, paddingBottom: 36 },
  header: { alignItems: 'center', marginBottom: 24 },
  logo: {
    width: 116,
    height: 116,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#2A2D30',
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  brand: { color: ACCENT, fontFamily: font.bold, fontSize: 11, letterSpacing: 3, marginTop: 14 },
  title: { color: TEXT, fontFamily: font.bold, fontSize: 28, lineHeight: 35, textAlign: 'center', marginTop: 6 },
  subtitle: { color: MUTED, fontFamily: font.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9, maxWidth: 340 },
  guestButton: {
    minHeight: 68,
    borderRadius: 20,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 18,
    shadowColor: ACCENT,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },
  guestCopy: { flex: 1, gap: 3 },
  guestButtonText: { color: '#052E24', fontFamily: font.bold, fontSize: 15 },
  guestButtonSubtext: { color: 'rgba(5,46,36,0.78)', fontFamily: font.medium, fontSize: 12 },
  guestArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(5,46,36,0.1)', alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  guestArrowText: { color: '#052E24', fontFamily: font.bold, fontSize: 25, lineHeight: 29, marginTop: -2 },
  guestPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: GLASS_BORDER },
  dividerText: { color: MUTED, fontFamily: font.semibold, fontSize: 10, letterSpacing: 1 },
  formCard: {
    gap: 12,
    padding: 18,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: 'rgba(255,255,255,0.045)',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  label: { color: TEXT, fontFamily: font.semibold, fontSize: 13 },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.2)',
    borderRadius: 16,
    backgroundColor: 'rgba(15,23,42,0.72)',
    paddingHorizontal: 16,
    color: TEXT,
    fontFamily: font.regular,
    fontSize: 15,
  },
  emailButton: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.48)',
    backgroundColor: 'rgba(16,185,129,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginTop: 2,
  },
  emailButtonText: { color: ACCENT, fontFamily: font.bold, fontSize: 14 },
  emailPressed: { backgroundColor: 'rgba(16,185,129,0.17)' },
  disabled: { opacity: 0.58 },
  helper: { color: MUTED, fontFamily: font.regular, fontSize: 11, lineHeight: 17 },
  notice: { padding: 14, marginTop: 16, borderRadius: 18, borderColor: 'rgba(16,185,129,0.32)', borderWidth: 1, backgroundColor: 'rgba(16,185,129,0.08)', gap: 4 },
  noticeTitle: { color: ACCENT, fontFamily: font.semibold, fontSize: 14 },
  noticeText: { color: TEXT, fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  errorBox: { padding: 14, marginTop: 16, borderRadius: 18, borderColor: 'rgba(244,63,94,0.4)', borderWidth: 1, backgroundColor: 'rgba(244,63,94,0.08)', gap: 6 },
  errorText: { color: TEXT, fontFamily: font.medium, fontSize: 13, lineHeight: 19 },
  errorHint: { color: '#FBBF24', fontFamily: font.regular, fontSize: 12, lineHeight: 18 },
  footer: { color: MUTED, fontFamily: font.regular, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 18 },
});
