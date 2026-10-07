import React, { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../api';
import { loadLatestSafetyVerification, requestSafetyVerification, subscribeToSafetyVerification, type SafetyVerification } from '../safety';
import { font, light as L } from '../theme';
import { friendlyError, showNotice } from '../userMessage';

export function SafetyVerificationPanel({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [verification, setVerification] = useState<SafetyVerification | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    void Promise.all([supabase.auth.getSession(), loadLatestSafetyVerification(requestId)])
      .then(async ([session, latest]) => {
        if (!active) return;
        setUserId(session.data.session?.user.id ?? null);
        setVerification(latest);
        stop = await subscribeToSafetyVerification(requestId, (next) => {
          if (!active) return;
          setVerification(next);
          if (next.status === 'pending' && next.target_user === session.data.session?.user.id) setPromptVisible(true);
        });
      })
      .catch(() => undefined);
    return () => { active = false; stop?.(); };
  }, [requestId]);

  useEffect(() => {
    if (verification?.status === 'pending' && verification.target_user === userId) setPromptVisible(true);
  }, [userId, verification]);

  const requestScan = async () => {
    if (requesting) return;
    setRequesting(true);
    setError(null);
    try {
      const next = await requestSafetyVerification(requestId);
      setVerification(next);
    } catch (caught) {
      setError(friendlyError(caught, 'We could not request a safety scan. Please try again.'));
    } finally { setRequesting(false); }
  };

  const openScan = () => {
    if (!verification) return;
    setPromptVisible(false);
    router.push({ pathname: '/safety/verify', params: { verificationId: verification.id } });
  };

  const callSafety = () => { void Linking.openURL('tel:112').catch(() => showNotice('Call unavailable', 'Please call emergency services at 112.')); };
  const pendingForMe = verification?.status === 'pending' && verification.target_user === userId;
  const pendingForOther = verification?.status === 'pending' && verification.requested_by === userId;
  const active = verification?.status === 'pending' || verification?.status === 'failed' || verification?.status === 'timed_out';

  return <>
    <View style={s.panel}>
      <View style={s.heading}><View style={s.shield}><Ionicons name="shield-checkmark" size={18} color={L.go} /></View><View style={{ flex: 1 }}><Text style={s.title}>Trip safety verification</Text><Text style={s.sub}>On-demand live identity check</Text></View>{verification?.status === 'verified' ? <Text style={s.verified}>VERIFIED</Text> : null}</View>
      {verification?.status === 'verified' ? <View style={s.success}><Ionicons name="checkmark-circle" size={17} color={L.go} /><Text style={s.successText}>Both participants passed the mock safety scan.</Text></View> : null}
      {pendingForOther ? <Text style={s.waiting}>Waiting for the other participant to complete the 60-second scan.</Text> : null}
      {pendingForMe ? <Pressable onPress={openScan} style={s.scanButton}><Ionicons name="camera" size={18} color={L.onGo} /><Text style={s.scanText}>Start safety scan · {Math.max(0, Math.ceil((new Date(verification!.expires_at).getTime() - Date.now()) / 1000))}s</Text></Pressable> : null}
      {!verification || (!active && verification.status !== 'verified') ? <Pressable disabled={requesting} onPress={() => { void requestScan(); }} style={[s.requestButton, requesting && s.off]}><Ionicons name="scan-outline" size={18} color={L.text} /><Text style={s.requestText}>{requesting ? 'Requesting scan…' : 'Request verification scan'}</Text></Pressable> : null}
      {verification?.status === 'failed' || verification?.status === 'timed_out' ? <View style={s.alert}><Text style={s.alertText}>Safety verification failed or expired. Fee-free cancellation is available.</Text><Pressable onPress={callSafety} style={s.sos}><Ionicons name="call" size={15} color="#fff" /><Text style={s.sosText}>Alert Safety Team / SOS</Text></Pressable></View> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
    <Modal visible={promptVisible && pendingForMe} transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={s.backdrop}><View style={s.modal}><View style={s.modalIcon}><Ionicons name="shield-checkmark" size={26} color={L.go} /></View><Text style={s.modalTitle}>Safety verification requested</Text><Text style={s.modalBody}>The other participant requested a live face and ID scan. Please complete it within 60 seconds.</Text><Pressable onPress={openScan} style={s.scanButton}><Ionicons name="camera" size={18} color={L.onGo} /><Text style={s.scanText}>Open camera scan</Text></Pressable><Pressable onPress={() => setPromptVisible(false)} style={s.later}><Text style={s.laterText}>Remind me in the active job</Text></Pressable></View></View>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  panel: { marginTop: 10, gap: 8, padding: 12, borderRadius: 14, backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shield: { width: 32, height: 32, borderRadius: 16, backgroundColor: L.goSoft, alignItems: 'center', justifyContent: 'center' },
  title: { color: L.text, fontFamily: font.bold, fontSize: 13 },
  sub: { color: L.textMuted, fontFamily: font.medium, fontSize: 11, marginTop: 2 },
  verified: { color: '#15803D', fontFamily: font.bold, fontSize: 10 },
  success: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  successText: { color: '#166534', fontFamily: font.medium, fontSize: 12, flex: 1 },
  waiting: { color: L.textMuted, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  requestButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: '#86EFAC', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  scanButton: { minHeight: 44, borderRadius: 12, backgroundColor: L.go, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  requestText: { color: L.text, fontFamily: font.bold, fontSize: 12 },
  scanText: { color: L.onGo, fontFamily: font.bold, fontSize: 12 },
  off: { opacity: 0.55 },
  alert: { gap: 8 },
  alertText: { color: '#991B1B', fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  sos: { height: 38, borderRadius: 10, backgroundColor: L.danger, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  sosText: { color: '#fff', fontFamily: font.bold, fontSize: 12 },
  error: { color: L.danger, fontFamily: font.medium, fontSize: 11 },
  backdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.62)', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: L.surface, borderRadius: 24, padding: 22, gap: 12 },
  modalIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: L.goSoft, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: L.text, fontFamily: font.bold, fontSize: 21 },
  modalBody: { color: L.textMuted, fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  later: { alignItems: 'center', padding: 8 },
  laterText: { color: L.textMuted, fontFamily: font.semibold, fontSize: 12 },
});
