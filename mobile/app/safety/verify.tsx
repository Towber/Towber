import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { completeSafetyVerification } from '../../src/safety';
import { font, light as L } from '../../src/theme';

export default function SafetyVerifyScreen() {
  const router = useRouter();
  const { verificationId } = useLocalSearchParams<{ verificationId: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [promptIndex, setPromptIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const prompts = useMemo(() => ['Look straight at the camera', 'Blink slowly', 'Turn your head slightly left'], []);

  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const promptTimer = setInterval(() => setPromptIndex((value) => (value + 1) % prompts.length), 3500);
    return () => clearInterval(promptTimer);
  }, [prompts.length]);

  useEffect(() => {
    if (secondsLeft !== 0 && !verificationId) return;
    if (secondsLeft === 0 && verificationId) {
      void finish(false, 'The verification window expired.');
    }
  }, [secondsLeft, verificationId]);

  const finish = async (passed: boolean, message?: string) => {
    if (!verificationId || submitting) return;
    setSubmitting(true);
    try {
      const result = await completeSafetyVerification(verificationId, passed);
      if (result.status === 'verified') {
        Alert.alert('Verification complete', 'Your identity scan passed. The trip now shows as verified.', [{ text: 'Continue', onPress: () => router.back() }]);
      } else {
        Alert.alert('Safety alert raised', message ?? result.failure_reason ?? 'The verification did not pass.', [{ text: 'Return', onPress: () => router.back() }]);
      }
    } catch (error) {
      setSubmitting(false);
      Alert.alert('Could not submit verification', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  if (!permission) return <View style={s.center}><ActivityIndicator color={L.go} /></View>;
  if (!permission.granted) return (
    <View style={s.permission}>
      <StatusBar style="light" />
      <Ionicons name="camera-outline" size={54} color={L.go} />
      <Text style={s.title}>Camera access needed</Text>
      <Text style={s.body}>Towber uses a live camera scan for this safety check. No image is stored in this mock development flow.</Text>
      <Pressable onPress={() => { void requestPermission(); }} style={s.primary}><Text style={s.primaryText}>Allow camera</Text></Pressable>
      <Pressable onPress={() => router.back()} style={s.secondary}><Text style={s.secondaryText}>Cancel</Text></Pressable>
    </View>
  );

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <CameraView style={StyleSheet.absoluteFill} facing="front" />
      <View style={s.overlay}>
        <View style={s.top}><Pressable accessibilityRole="button" onPress={() => router.back()} style={s.close}><Ionicons name="close" size={25} color="#fff" /></Pressable><Text style={s.topTitle}>SAFETY VERIFICATION</Text><View style={s.timer}><Text style={s.timerText}>{secondsLeft}s</Text></View></View>
        <View style={s.faceFrame}><View style={s.cornerTL} /><View style={s.cornerTR} /><View style={s.cornerBL} /><View style={s.cornerBR} /><Ionicons name="scan-outline" size={120} color="rgba(255,255,255,0.35)" /></View>
        <View style={s.instructions}><Text style={s.eyebrow}>LIVE MOCK CHECK</Text><Text style={s.prompt}>{prompts[promptIndex]}</Text><Text style={s.bodyLight}>Keep your face and ID/driver’s licence visible in the frame. The development mock does not upload or retain the image.</Text><Pressable disabled={submitting || secondsLeft === 0} onPress={() => { void finish(true); }} style={[s.primary, (submitting || secondsLeft === 0) && s.disabled]}>{submitting ? <ActivityIndicator color={L.onGo} /> : <Text style={s.primaryText}>Complete mock verification</Text>}</Pressable><Pressable disabled={submitting} onPress={() => { void finish(false); }} style={s.fail}><Text style={s.failText}>I cannot complete this scan</Text></Pressable></View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827' },
  center: { flex: 1, backgroundColor: L.bg, alignItems: 'center', justifyContent: 'center' },
  permission: { flex: 1, backgroundColor: L.bg, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'space-between', padding: 18, paddingTop: 54, paddingBottom: 30 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  close: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, color: '#fff', fontFamily: font.bold, fontSize: 12, letterSpacing: 1.2 },
  timer: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(220,38,38,0.88)' },
  timerText: { color: '#fff', fontFamily: font.bold, fontSize: 13 },
  faceFrame: { width: 250, height: 310, borderRadius: 125, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  cornerTL: { position: 'absolute', left: -2, top: 55, width: 30, height: 30, borderLeftWidth: 4, borderTopWidth: 4, borderColor: L.go },
  cornerTR: { position: 'absolute', right: -2, top: 55, width: 30, height: 30, borderRightWidth: 4, borderTopWidth: 4, borderColor: L.go },
  cornerBL: { position: 'absolute', left: -2, bottom: 55, width: 30, height: 30, borderLeftWidth: 4, borderBottomWidth: 4, borderColor: L.go },
  cornerBR: { position: 'absolute', right: -2, bottom: 55, width: 30, height: 30, borderRightWidth: 4, borderBottomWidth: 4, borderColor: L.go },
  instructions: { backgroundColor: 'rgba(17,24,39,0.88)', borderRadius: 24, padding: 20, gap: 10 },
  eyebrow: { color: L.go, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.2 },
  title: { color: L.text, fontFamily: font.bold, fontSize: 23, textAlign: 'center' },
  prompt: { color: '#fff', fontFamily: font.bold, fontSize: 20 },
  body: { color: L.textMuted, fontFamily: font.medium, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  bodyLight: { color: 'rgba(255,255,255,0.76)', fontFamily: font.medium, fontSize: 13, lineHeight: 19 },
  primary: { minHeight: 50, borderRadius: 999, backgroundColor: L.go, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 4 },
  primaryText: { color: L.onGo, fontFamily: font.bold, fontSize: 15 },
  secondary: { minHeight: 46, justifyContent: 'center', paddingHorizontal: 18 },
  secondaryText: { color: L.textMuted, fontFamily: font.bold, fontSize: 14 },
  disabled: { opacity: 0.5 },
  fail: { alignItems: 'center', padding: 8 },
  failText: { color: '#FCA5A5', fontFamily: font.semibold, fontSize: 13 },
});
