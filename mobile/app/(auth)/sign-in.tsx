import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../../src/api';
import { BRAND, TOWBERPRO as PARTNER } from '../../src/copy';
import { setPartnerIntent } from '../../src/partnerIntent';
import { font, light as L } from '../../src/theme';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [sendingLink, setSendingLink] = useState(false);
  const [startingGuest, setStartingGuest] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentForApplication, setSentForApplication] = useState(false);
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
    setSentForApplication(false);
    try {
      // New applicants may create an account (least-privileged `client` role); invited
      // partners must already exist. The flag sends applicants to the application after sign-in.
      await setPartnerIntent(isNewPartner);
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: Linking.createURL('/auth/callback', {
            queryParams: isNewPartner ? { apply: '1' } : undefined,
          }),
          shouldCreateUser: isNewPartner,
        },
      });
      if (signInError) throw signInError;
      setSentTo(normalizedEmail);
      setSentForApplication(isNewPartner);
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
        <View style={styles.content}>
          <View style={styles.header}>
            <Image accessibilityLabel="Towber logo" source={require('../../assets/images/towber-icon-rounded-512.png')} resizeMode="contain" style={styles.logo} />
            <Text style={styles.brand}>Towber</Text>
            <Text style={styles.tagline}>{BRAND.tagline}</Text>
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
            <Text style={styles.cardBody}>Sign in with your email, or apply to offer towing, fuel, tyres and roadside help.</Text>
            <TextInput
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={(value) => { setEmail(value); setError(null); setSentTo(null); setSentForApplication(false); }}
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
              <Text style={styles.applyText}>New here? Apply as a {PARTNER.singular}</Text>
            </Pressable>
          </View>

          {sentTo ? (
            <View accessibilityLiveRegion="polite" style={styles.notice}>
              <Text style={styles.noticeTitle}>Check your email</Text>
              <Text style={styles.noticeText}>{sentForApplication ? `We sent a verification link to ${sentTo}. Open it on this phone and your TowberPro application will open next.` : `We sent a one-time link to ${sentTo}. Open it on this phone to return to Towber.`}</Text>
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
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: L.bg },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 18, gap: 10 },
  header: { alignItems: 'center', marginBottom: 2 },
  logo: { width: 76, height: 76, marginBottom: 8 },
  brand: { color: L.text, fontFamily: font.bold, fontSize: 30, letterSpacing: -1 },
  tagline: { color: L.textMuted, fontFamily: font.medium, fontSize: 13, marginTop: 2 },
  card: { padding: 14, borderRadius: 18, backgroundColor: L.surfaceRaised, gap: 8 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: L.goSoft },
  tagDark: { backgroundColor: '#111827' },
  tagText: { color: L.go, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.1 },
  cardTitle: { color: L.text, fontFamily: font.bold, fontSize: 20, letterSpacing: -0.4 },
  cardBody: { color: L.textMuted, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  primaryButton: { height: 46, borderRadius: 999, backgroundColor: L.go, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  primaryText: { color: L.onGo, fontFamily: font.bold, fontSize: 14 },
  input: { height: 46, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: L.border, paddingHorizontal: 14, color: L.text, fontFamily: font.medium, fontSize: 15 },
  darkButton: { height: 46, borderRadius: 999, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  darkText: { color: '#FFFFFF', fontFamily: font.bold, fontSize: 14 },
  applyButton: { height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#111827' },
  applyText: { color: '#111827', fontFamily: font.semibold, fontSize: 13 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.55 },
  notice: { padding: 10, borderRadius: 13, backgroundColor: L.goSoft, gap: 3 },
  noticeTitle: { color: L.go, fontFamily: font.bold, fontSize: 13 },
  noticeText: { color: L.text, fontFamily: font.regular, fontSize: 11, lineHeight: 16 },
  errorBox: { padding: 10, borderRadius: 13, backgroundColor: 'rgba(220,38,38,0.08)', gap: 4 },
  errorText: { color: L.danger, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  errorHint: { color: L.warn, fontFamily: font.regular, fontSize: 11, lineHeight: 16 },
  footer: { color: L.textMuted, fontFamily: font.regular, fontSize: 10, lineHeight: 14, textAlign: 'center', paddingHorizontal: 10 },
});
