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
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../../src/api';
import { PARTNER } from '../../src/copy';
import { setPartnerIntent } from '../../src/partnerIntent';
import { font, light as L } from '../../src/theme';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [sendingLink, setSendingLink] = useState(false);
  const [startingGuest, setStartingGuest] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendMagicLink = async (isNewPartner = false) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    setSendingLink(true);
    setError(null);
    setSentTo(null);
    try {
      // New applicants may create an account (least-privileged `client` role); invited
      // partners must already exist. The flag sends applicants to the application after sign-in.
      await setPartnerIntent(isNewPartner);
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: Linking.createURL('/auth/callback'),
          shouldCreateUser: isNewPartner,
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
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Image accessible accessibilityLabel="Towber logo" resizeMode="contain" source={require('../../assets/icon.png')} style={styles.logo} />
            <Text style={styles.brand}>Towber</Text>
            <Text style={styles.tagline}>Roadside help, when you need it.</Text>
          </View>

          {/* GUEST PORTAL */}
          <View style={styles.card}>
            <View style={styles.tag}><Text style={styles.tagText}>GUEST PORTAL</Text></View>
            <Text style={styles.cardTitle}>Stuck on the road?</Text>
            <Text style={styles.cardBody}>Request a tow, jump start, fuel or a tyre change. No account needed.</Text>
            <Pressable
              accessibilityRole="button"
              disabled={actionsDisabled}
              onPress={() => { void continueAsClient(); }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, actionsDisabled && styles.disabled]}
            >
              {startingGuest ? <ActivityIndicator color={L.onGo} /> : <Text style={styles.primaryText}>Get help now</Text>}
            </Pressable>
          </View>

          {/* PARTNER PORTAL */}
          <View style={styles.card}>
            <View style={[styles.tag, styles.tagDark]}><Text style={[styles.tagText, { color: '#FFFFFF' }]}>{PARTNER.portalTag}</Text></View>
            <Text style={styles.cardTitle}>{PARTNER.Plural}</Text>
            <Text style={styles.cardBody}>Towing, fuel, tyres and more. Sign in with the email Towber invited and we’ll send you a one-time link.</Text>
            <TextInput
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={(value) => { setEmail(value); setError(null); setSentTo(null); }}
              placeholder="Email address"
              placeholderTextColor={L.disabledText}
              returnKeyType="send"
              style={styles.input}
              value={email}
              onSubmitEditing={() => { void sendMagicLink(false); }}
            />
            <Pressable
              accessibilityRole="button"
              disabled={actionsDisabled}
              onPress={() => { void sendMagicLink(false); }}
              style={({ pressed }) => [styles.darkButton, pressed && styles.pressed, actionsDisabled && styles.disabled]}
            >
              {sendingLink ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.darkText}>Email me a sign-in link</Text>}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={actionsDisabled}
              onPress={() => { void sendMagicLink(true); }}
              style={({ pressed }) => [styles.applyButton, pressed && styles.pressed, actionsDisabled && styles.disabled]}
            >
              <Text style={styles.applyText}>New here? Apply to become a {PARTNER.singular}</Text>
            </Pressable>
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
  safe: { flex: 1, backgroundColor: L.bg },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32, gap: 16 },
  header: { alignItems: 'center', marginBottom: 8 },
  logo: { width: 84, height: 84, borderRadius: 22 },
  brand: { color: L.text, fontFamily: font.bold, fontSize: 34, letterSpacing: -1, marginTop: 14 },
  tagline: { color: L.textMuted, fontFamily: font.medium, fontSize: 15, marginTop: 4 },
  card: { padding: 20, borderRadius: 22, backgroundColor: L.surfaceRaised, gap: 12 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: L.goSoft },
  tagDark: { backgroundColor: '#111827' },
  tagText: { color: L.go, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.2 },
  cardTitle: { color: L.text, fontFamily: font.bold, fontSize: 24, letterSpacing: -0.5 },
  cardBody: { color: L.textMuted, fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  primaryButton: { height: 54, borderRadius: 999, backgroundColor: L.go, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: L.onGo, fontFamily: font.bold, fontSize: 16 },
  input: { height: 52, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: L.border, paddingHorizontal: 16, color: L.text, fontFamily: font.medium, fontSize: 16 },
  darkButton: { height: 54, borderRadius: 999, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  darkText: { color: '#FFFFFF', fontFamily: font.bold, fontSize: 16 },
  applyButton: { height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#111827' },
  applyText: { color: '#111827', fontFamily: font.semibold, fontSize: 14 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.55 },
  notice: { padding: 14, borderRadius: 16, backgroundColor: L.goSoft, gap: 4 },
  noticeTitle: { color: L.go, fontFamily: font.bold, fontSize: 14 },
  noticeText: { color: L.text, fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  errorBox: { padding: 14, borderRadius: 16, backgroundColor: 'rgba(220,38,38,0.08)', gap: 6 },
  errorText: { color: L.danger, fontFamily: font.medium, fontSize: 13, lineHeight: 19 },
  errorHint: { color: L.warn, fontFamily: font.regular, fontSize: 12, lineHeight: 18 },
  footer: { color: L.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 12 },
});
