import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, Slot, useRouter, useSegments } from 'expo-router';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '../src/api';
import { subscribeToIncomingMessages, type RequestMessage } from '../src/chat';
import { playIncomingChatAlert } from '../src/chatAlert';
import { hasPartnerIntent } from '../src/partnerIntent';
import { colors, font } from '../src/theme';

type AppRole = 'client' | 'driver';
type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'ready'; role: AppRole }
  | { status: 'error'; message: string };

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const inAuthGroup = segments[0] === '(auth)';
  const inAuthCallback = segments[0] === 'auth' && segments[1] === 'callback';
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [incomingMessage, setIncomingMessage] = useState<RequestMessage | null>(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const slotShown = useRef(false);
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    let active = true;
    let generation = 0;

    const loadRole = async (initialSession?: Session | null): Promise<AppRole | null> => {
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
          return null;
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
        return profile.role;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load your Towber profile.';
        if (active && request === generation) setAuthState({ status: 'error', message });
        return null;
      }
    };

    void loadRole();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Avoid calling Supabase auth methods while inside the auth callback lock.
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      setAuthState({ status: 'loading' });
      setTimeout(() => {
        if (!active) return;
        void loadRole(session).then(async (role) => {
          if (!active || event !== 'SIGNED_IN' || !role || inAuthCallback) return;
          if (role === 'client' && await hasPartnerIntent()) router.replace('/partner/apply');
          else router.replace(role === 'driver' ? '/(main)/driver' : '/(main)/client');
        });
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [retry, router]);

  useEffect(() => {
    let active = true;

    const handleAuthUrl = (url: string) => {
      const parsed = Linking.parse(url);
      const path = (parsed.path ?? '').replace(/^\/+/, '');
      const callbackPath = path.split('/').filter((part) => part !== '--').join('/');
      const params = parsed.queryParams ?? {};
      const isAuthCallback = callbackPath.endsWith('auth/callback') ||
        params.code !== undefined || params.error !== undefined;
      if (!active || !isAuthCallback) return;

      const firstValue = (value: string | string[] | undefined) =>
        Array.isArray(value) ? value[0] : value;
      router.replace({
        pathname: '/auth/callback',
        params: {
          code: firstValue(params.code),
          error: firstValue(params.error),
          error_description: firstValue(params.error_description),
          apply: firstValue(params.apply),
        },
      });
    };

    const subscription = Linking.addEventListener('url', ({ url }) => handleAuthUrl(url));
    void Linking.getInitialURL().then((url) => { if (url) handleAuthUrl(url); });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [inAuthCallback, router]);

  // Keep chat alerts active while the user is on the map, active job, or any
  // other authenticated route. The chat screen remains responsible for
  // rendering the message itself; this shell owns the cross-app alert.
  useEffect(() => {
    if (authState.status !== 'ready') return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active || !data.session) return;
      unsubscribe = subscribeToIncomingMessages((message) => {
        if (!active || message.sender_user_id === data.session?.user.id) return;
        void playIncomingChatAlert();
        if (segmentsRef.current[1] !== 'chat') setIncomingMessage(message);
      });
    });
    return () => { active = false; unsubscribe?.(); };
  }, [authState.status]);

  // Where the auth state says we should be (null = stay put).
  let redirectTo: '/(auth)/sign-in' | '/(main)/driver' | '/(main)/client' | null = null;
  if (!inAuthCallback) {
    if (authState.status === 'signed_out') {
      if (!inAuthGroup) redirectTo = '/(auth)/sign-in';
    } else if (authState.status === 'ready') {
      const home = authState.role === 'driver' ? '/(main)/driver' : '/(main)/client';
      // Chat lives under (main) but is shared by both roles, so it must not be bounced to the role home.
      const onSharedMainRoute = segments[0] === '(main)' && segments[1] === 'chat';
      if (inAuthGroup || (segments[0] === '(main)' && !onSharedMainRoute && segments[1] !== authState.role)) redirectTo = home;
    }
  }

  // Keep the navigator mounted once it has been shown. Unmounting it while auth
  // state changes (e.g. on sign-out) left the redirect with nothing to render
  // into, which is what produced the blank screen after "Switch account".
  const slotReady = fontsLoaded && (inAuthCallback || authState.status === 'signed_out' || authState.status === 'ready');
  if (slotReady) slotShown.current = true;
  const showSlot = fontsLoaded && (slotReady || slotShown.current);

  if (!showSlot) {
    if (authState.status === 'error') return <AppFrame><ErrorScreen message={authState.message} onRetry={() => setRetry((value) => value + 1)} /></AppFrame>;
    return <LoadingScreen />;
  }

  return (
    <AppFrame>
      <Slot />
      {incomingMessage && segmentsRef.current[1] !== 'chat' ? (
        <IncomingChatBanner
          message={incomingMessage}
          onOpen={() => {
            const requestId = incomingMessage.request_id;
            setIncomingMessage(null);
            router.push({ pathname: '/(main)/chat/[requestId]', params: { requestId } });
          }}
          onDismiss={() => setIncomingMessage(null)}
        />
      ) : null}
      {redirectTo ? <Redirect href={redirectTo} /> : null}
      {!inAuthCallback && authState.status === 'loading' ? <View style={StyleSheet.absoluteFill}><LoadingScreen /></View> : null}
      {!inAuthCallback && authState.status === 'error' ? (
        <View style={StyleSheet.absoluteFill}><ErrorScreen message={authState.message} onRetry={() => setRetry((value) => value + 1)} /></View>
      ) : null}
    </AppFrame>
  );
}

function IncomingChatBanner({ message, onOpen, onDismiss }: { message: RequestMessage; onOpen: () => void; onDismiss: () => void }) {
  return (
    <View pointerEvents="box-none" style={styles.bannerWrap}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open incoming chat message" onPress={onOpen} style={styles.banner}>
        <View style={styles.bannerIcon}><Text style={styles.bannerIconText}>●</Text></View>
        <View style={styles.bannerCopy}>
          <Text style={styles.bannerTitle}>New Towber message</Text>
          <Text style={styles.bannerBody} numberOfLines={2}>{message.body}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message alert" onPress={onDismiss} style={styles.bannerClose}>
          <Text style={styles.bannerCloseText}>×</Text>
        </Pressable>
      </Pressable>
    </View>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.messageWrap}>
      <Text style={styles.title}>Towber profile unavailable</Text>
      <Text style={styles.body}>{message}</Text>
      <Text style={styles.hint}>{authHint(message)}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => { void supabase.auth.signOut({ scope: 'local' }); }} style={styles.textButton}>
        <Text style={styles.textButtonLabel}>Sign out / use another account</Text>
      </Pressable>
    </View>
  );
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
  bannerWrap: { position: 'absolute', top: 48, left: 14, right: 14, zIndex: 100 },
  banner: { minHeight: 68, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, elevation: 8, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  bannerIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  bannerIconText: { color: colors.go, fontSize: 15 },
  bannerCopy: { flex: 1, gap: 3 },
  bannerTitle: { color: colors.text, fontFamily: font.bold, fontSize: 13 },
  bannerBody: { color: colors.textMuted, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  bannerClose: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  bannerCloseText: { color: colors.textMuted, fontFamily: font.regular, fontSize: 24, lineHeight: 24 },
});
