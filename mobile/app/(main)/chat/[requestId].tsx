import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { supabase } from '../../../src/api';
import { loadRequestMessages, sendRequestMessage, subscribeToRequestMessages, type RequestMessage } from '../../../src/chat';
import { font, light as L } from '../../../src/theme';

export default function RequestChatScreen() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const { top, bottom } = useSafeAreaInsets();
  const [messages, setMessages] = useState<RequestMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<RequestMessage>>(null);

  useEffect(() => {
    if (!requestId) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    Promise.all([
      loadRequestMessages(requestId),
      supabase.auth.getSession(),
    ]).then(([loaded, session]) => {
      if (!active) return;
      setMessages(loaded);
      setUserId(session.data.session?.user.id ?? null);
      return subscribeToRequestMessages(requestId, (message) => {
        if (!active) return;
        setMessages((previous) => previous.some((item) => item.id === message.id) ? previous : [...previous, message]);
      });
    }).then((stop) => { if (active) unsubscribe = stop; else stop?.(); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load chat.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsubscribe?.(); };
  }, [requestId]);

  const send = async () => {
    if (!requestId || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const message = await sendRequestMessage(requestId, draft);
      if (message) {
        setMessages((previous) => previous.some((item) => item.id === message.id) ? previous : [...previous, message]);
        setDraft('');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send message.');
    } finally { setSending(false); }
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      <View style={[s.header, { paddingTop: top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={s.headerButton}>
          <Ionicons name="chevron-back" size={24} color={L.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>REQUEST CHAT</Text>
          <Text style={s.title}>Towber support thread</Text>
        </View>
        <View style={s.headerIcon}><Ionicons name="chatbubbles-outline" size={20} color={L.go} /></View>
      </View>
      <View style={s.rule} />
      {loading ? <View style={s.center}><ActivityIndicator color={L.go} /></View> : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[s.list, messages.length === 0 && s.emptyList]}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.sender_user_id === userId;
            return <View style={[s.message, mine ? s.mine : s.theirs]}><Text style={[s.messageText, mine && s.mineText]}>{item.body}</Text><Text style={[s.time, mine && s.mineTime]}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text></View>;
          }}
          ListEmptyComponent={<View style={s.empty}><Ionicons name="chatbubble-ellipses-outline" size={30} color={L.go} /><Text style={s.emptyTitle}>Start the conversation</Text><Text style={s.emptyBody}>Message the other person with an update, arrival note or question.</Text></View>}
        />
      )}
      {error ? <Text style={s.error}>{error}</Text> : null}
      <View style={[s.composer, { paddingBottom: Math.max(bottom, 10) + 8 }]}>
        <TextInput
          accessibilityLabel="Message"
          value={draft}
          onChangeText={setDraft}
          placeholder="Write a message…"
          placeholderTextColor={L.disabledText}
          multiline
          maxLength={1000}
          style={s.input}
          onSubmitEditing={() => { void send(); }}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={!draft.trim() || sending} onPress={() => { void send(); }} style={[s.send, (!draft.trim() || sending) && s.sendOff]}>
          {sending ? <ActivityIndicator color={L.onGo} size="small" /> : <Ionicons name="arrow-up" size={22} color={L.onGo} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: L.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  headerButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: L.surface, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: L.goSoft, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: L.go, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.3 },
  title: { color: L.text, fontFamily: font.bold, fontSize: 18, marginTop: 2 },
  rule: { height: 1, backgroundColor: L.border },
  list: { padding: 16, gap: 10 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  message: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, gap: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: L.go, borderBottomRightRadius: 5 },
  theirs: { alignSelf: 'flex-start', backgroundColor: L.surface, borderBottomLeftRadius: 5 },
  messageText: { color: L.text, fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  mineText: { color: L.onGo },
  time: { color: L.textMuted, fontFamily: font.medium, fontSize: 10, textAlign: 'right' },
  mineTime: { color: 'rgba(255,255,255,0.72)' },
  empty: { alignItems: 'center', gap: 8, padding: 28 },
  emptyTitle: { color: L.text, fontFamily: font.bold, fontSize: 17 },
  emptyBody: { color: L.textMuted, fontFamily: font.medium, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: L.danger, fontFamily: font.medium, fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingTop: 10, backgroundColor: L.surface, borderTopWidth: 1, borderTopColor: L.border },
  input: { flex: 1, minHeight: 44, maxHeight: 110, borderRadius: 18, backgroundColor: L.surfaceRaised, paddingHorizontal: 14, paddingVertical: 11, color: L.text, fontFamily: font.medium, fontSize: 14 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: L.go, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.45 },
});
