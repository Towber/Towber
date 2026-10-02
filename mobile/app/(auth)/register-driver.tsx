import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase, uploadDriverAvatar } from '../../src/api';
import { colors, font, radius } from '../../src/theme';

export default function RegisterDriverScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const choosePhoto = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo access is needed to choose your driver headshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  const saveProfile = async () => {
    if (!fullName.trim()) {
      setError('Enter your full name.');
      return;
    }
    if (!photoUri) {
      setError('Upload a profile/headshot photo to continue.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const user = sessionData.session?.user;
      if (!user) throw new Error('Sign in with your invited driver email before completing registration.');
      const avatarUrl = await uploadDriverAvatar(photoUri, user.id);
      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({ full_name: fullName.trim(), phone: phone.trim() || null, avatar_url: avatarUrl })
        .eq('user_id', user.id);
      if (profileError) throw profileError;
      setSaved(true);
      setTimeout(() => router.replace('/(main)/driver'), 700);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your driver profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>DRIVER ONBOARDING</Text>
        <Text style={styles.title}>Complete your driver profile</Text>
        <Text style={styles.subtitle}>Your photo and contact details help motorists identify and reach the assigned driver.</Text>

        <Pressable accessibilityRole="button" accessibilityLabel="Upload profile or headshot photo" onPress={() => { void choosePhoto(); }} style={styles.photoPicker}>
          {photoUri ? <Image source={{ uri: photoUri }} style={styles.photo} /> : <View style={styles.placeholder}><Text style={styles.placeholderIcon}>＋</Text><Text style={styles.placeholderText}>Upload Profile / Headshot Photo</Text></View>}
        </Pressable>
        {photoUri ? <Text style={styles.photoHint}>Tap the photo to choose a different image.</Text> : null}

        <Text style={styles.label}>Full name</Text>
        <TextInput value={fullName} onChangeText={setFullName} placeholder="e.g. Thabo Mokoena" placeholderTextColor={colors.textMuted} style={styles.input} autoCapitalize="words" />
        <Text style={styles.label}>Phone number</Text>
        <TextInput value={phone} onChangeText={setPhone} placeholder="e.g. 082 123 4567" placeholderTextColor={colors.textMuted} style={styles.input} keyboardType="phone-pad" />

        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        {saved ? <Text style={styles.success}>Profile saved. Opening driver mode…</Text> : null}
        <Pressable accessibilityRole="button" disabled={saving || saved} onPress={() => { void saveProfile(); }} style={[styles.button, (saving || saved) && styles.disabled]}>
          {saving ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.buttonText}>Save Driver Profile</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, padding: 24, paddingBottom: 40 },
  back: { alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 28 },
  backText: { color: colors.route, fontFamily: font.semibold, fontSize: 14 },
  eyebrow: { color: colors.go, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5 },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 28, lineHeight: 35, marginTop: 8 },
  subtitle: { color: colors.textMuted, fontFamily: font.regular, fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 24 },
  photoPicker: { alignSelf: 'center', width: 152, height: 152, borderRadius: 76, borderWidth: 1, borderColor: colors.route, borderStyle: 'dashed', overflow: 'hidden', marginBottom: 8 },
  photo: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: colors.surface },
  placeholderIcon: { color: colors.route, fontSize: 28, lineHeight: 30 },
  placeholderText: { color: colors.textMuted, fontFamily: font.semibold, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 4 },
  photoHint: { color: colors.textMuted, fontFamily: font.medium, fontSize: 11, textAlign: 'center', marginBottom: 20 },
  label: { color: colors.text, fontFamily: font.semibold, fontSize: 13, marginTop: 14, marginBottom: 8 },
  input: { minHeight: 54, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface, color: colors.text, fontFamily: font.regular, fontSize: 15, paddingHorizontal: 16 },
  error: { color: colors.warn, fontFamily: font.medium, fontSize: 13, lineHeight: 19, marginTop: 18 },
  success: { color: colors.go, fontFamily: font.medium, fontSize: 13, lineHeight: 19, marginTop: 18 },
  button: { minHeight: 56, borderRadius: radius.card, backgroundColor: colors.go, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  buttonText: { color: colors.bg, fontFamily: font.bold, fontSize: 15 },
  disabled: { opacity: 0.6 },
});
