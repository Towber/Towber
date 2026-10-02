import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { supabase } from '../../src/api';
import { colors, font } from '../../src/theme';

type AppRole = 'client' | 'driver';

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string | string[]; error?: string | string[]; error_description?: string | string[] }>();
  const router = useRouter();
  const code = first(params.code);
  const authError = first(params.error_description) ?? first(params.error);
  const exchange = useRef<Promise<AppRole> | null>(null);
  const [message, setMessage] = useState('Verifying sign-in link...');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!code && !authError) {
      setFailed(true);
      setMessage('The sign-in link is missing its one-time code. Request a new link and open it on this phone.');
      return () => { active = false; };
    }

    if (!exchange.current) {
      exchange.current = (async () => {
        if (authError) throw new Error(authError);
        const { data, error } = await supabase.auth.exchangeCodeForSession(code!);
        if (error) throw error;
        if (!data.session) throw new Error('The sign-in link did not create a session. Request a fresh link and try again.');
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('user_id', data.session.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (profile?.role !== 'client' && profile?.role !== 'driver') {
          throw new Error('Your Towber profile has no valid role. Ask an administrator to provision it.');
        }
        return profile.role;
      })();
    }

    void exchange.current
      .then((role) => {
        if (!active) return;
        setMessage('Sign-in complete. Opening your Towber portal…');
        router.replace(role === 'driver' ? '/(main)/driver' : '/(main)/client');
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setFailed(true);
        setMessage(caught instanceof Error ? caught.message : 'Could not finish sign-in. Request a new link and try again.');
      });

    return () => { active = false; };
  }, [authError, code]);

  return (
    <View style={styles.root}>
      {failed ? null : <ActivityIndicator color="#10B981" size="large" />}
      <Text style={styles.title}>{failed ? 'Sign-in link unavailable' : 'Signing you in'}</Text>
      <Text style={styles.message}>{message}</Text>
      {failed ? (
        <Pressable accessibilityRole="button" onPress={() => router.replace('/(auth)/sign-in')} style={styles.button}>
          <Text style={styles.buttonText}>Back to sign in</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 22, textAlign: 'center' },
  message: { color: colors.textMuted, fontFamily: font.regular, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { minHeight: 50, paddingHorizontal: 22, marginTop: 8, borderRadius: 15, backgroundColor: colors.go, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.bg, fontFamily: font.bold, fontSize: 14 },
});
