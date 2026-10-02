import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, Slot, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '../src/api';
import { colors, font } from '../src/theme';

type AppRole = 'client' | 'driver';
type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'ready'; role: AppRole }
  | { status: 'error'; message: string };

export default function RootLayout() {
  const segments = useSegments() as string[];
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    let active = true;
    let generation = 0;

    const loadRole = async (initialSession?: Session | null) => {
      const request = ++generation;
      if (active) setAuthState({ status: 'loading' });
      try {
        let session = initialSession;
        if (session === undefined) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          session = data.session;
        }
        if (!session) {
          if (active && request === generation) setAuthState({ status: 'signed_out' });
          return;
        }

        const { data: profile, error } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (error) throw error;
        if (profile?.role !== 'client' && profile?.role !== 'driver') {
          throw new Error('Your Towber profile has no valid role. Ask an administrator to provision it.');
        }
        if (active && request === generation) setAuthState({ status: 'ready', role: profile.role });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load your Towber profile.';
        if (active && request === generation) setAuthState({ status: 'error', message });
      }
    };

    void loadRole();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Avoid calling Supabase auth methods while inside the auth callback lock.
      if (event === 'INITIAL_SESSION') return;
      setTimeout(() => { if (active) void loadRole(session); }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [retry]);

  if (!fontsLoaded || authState.status === 'loading') return <LoadingScreen />;

  const inAuthGroup = segments[0] === '(auth)';
  const inAuthCallback = segments[0] === 'auth' && segments[1] === 'callback';

  if (authState.status === 'error') {
    const hint = authHint(authState.message);
    return (
      <AppFrame>
        <View style={styles.messageWrap}>
          <Text style={styles.title}>Towber profile unavailable</Text>
          <Text style={styles.body}>{authState.message}</Text>
          <Text style={styles.hint}>{hint}</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { void supabase.auth.signOut(); }} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Sign out / use another account</Text>
          </Pressable>
        </View>
      </AppFrame>
    );
  }

  if (authState.status === 'signed_out') {
    if (inAuthGroup || inAuthCallback) return <AppFrame><Slot /></AppFrame>;
    return <Redirect href="/(auth)/sign-in" />;
  }

  const role = authState.role;
  const home = role === 'driver' ? '/(main)/driver' : '/(main)/client';
  if (inAuthGroup || inAuthCallback) return <Redirect href={home} />;
  if (segments[0] === '(main)' && segments[1] !== role) return <Redirect href={home} />;

  return <AppFrame><Slot /></AppFrame>;
}

function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {children}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function authHint(message: string) {
  if (/anonymous sign-ins are disabled/i.test(message)) {
    return 'Enable Anonymous Sign-Ins in Supabase Auth settings, or use an invited email sign-in link.';
  }
  if (/user_profiles|schema cache|does not exist/i.test(message)) {
    return 'Check that the Supabase profile/role migrations have been applied, then retry.';
  }
  return 'Check your connection and Supabase Auth/profile settings, then try again.';
}

function LoadingScreen() {
  return <View style={styles.loading}><ActivityIndicator size="large" color={colors.go} /><Text style={styles.loadingText}>Loading Towber…</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { color: colors.textMuted, fontFamily: font.medium, fontSize: 14 },
  messageWrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 21, textAlign: 'center' },
  body: { color: colors.textMuted, fontFamily: font.regular, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  hint: { color: colors.warn, fontFamily: font.medium, fontSize: 13, textAlign: 'center' },
  retry: { marginTop: 8, paddingHorizontal: 24, height: 48, borderRadius: 14, backgroundColor: colors.go, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: colors.bg, fontFamily: font.bold, fontSize: 15 },
  textButton: { padding: 10 },
  textButtonLabel: { color: colors.textMuted, fontFamily: font.medium, fontSize: 13 },
});
