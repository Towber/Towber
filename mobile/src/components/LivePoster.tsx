import React from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { font, light as L } from '../theme';
import { useLiveContent, type LiveContent } from '../liveContent';

function Poster({ item }: { item: LiveContent }) {
  const open = () => { if (item.action_url) void Linking.openURL(item.action_url).catch(() => undefined); };
  const body = (
    <>
      {item.image_url ? <Image source={{ uri: item.image_url }} style={s.image} resizeMode="cover" /> : null}
      <View style={s.copy}><Text style={s.eyebrow}>LIVE FROM TOWBER</Text><Text style={s.title}>{item.title}</Text>{item.body ? <Text style={s.body}>{item.body}</Text> : null}</View>
      {item.action_url ? <Ionicons name="arrow-forward-circle" size={24} color={L.go} /> : null}
    </>
  );
  return item.action_url ? <Pressable accessibilityRole="link" onPress={open} style={s.card}>{body}</Pressable> : <View style={s.card}>{body}</View>;
}

export function LivePosterStrip() {
  const { content } = useLiveContent();
  if (!content.length) return null;
  return <View style={s.wrap}><Poster item={content[0]} /></View>;
}

const s = StyleSheet.create({
  wrap: { marginBottom: 16 },
  card: { minHeight: 112, borderRadius: 18, overflow: 'hidden', backgroundColor: L.surface, borderWidth: 1, borderColor: L.border, flexDirection: 'row', alignItems: 'center' },
  image: { width: 108, height: 112, backgroundColor: L.surfaceRaised },
  copy: { flex: 1, padding: 14, gap: 4 },
  eyebrow: { color: L.go, fontFamily: font.bold, fontSize: 9, letterSpacing: 1.1 },
  title: { color: L.text, fontFamily: font.bold, fontSize: 16 },
  body: { color: L.textMuted, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
});
