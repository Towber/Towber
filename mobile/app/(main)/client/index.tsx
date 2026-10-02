import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchActiveRequest, supabase, type BreakdownType, type ServiceFor } from '../../../src/api';
import { TopBar } from '../../../src/components/TopBar';
import { SERVICES, getDraft, setDraft } from '../../../src/requestDraft';
import { font, light as L } from '../../../src/theme';

const COLORS: { name: string; hex: string }[] = [
  { name: 'White', hex: '#FFFFFF' }, { name: 'Black', hex: '#111111' }, { name: 'Silver', hex: '#C0C4CC' },
  { name: 'Grey', hex: '#6B7280' }, { name: 'Red', hex: '#DC2626' }, { name: 'Blue', hex: '#2563EB' },
  { name: 'Green', hex: '#16A34A' }, { name: 'Other', hex: 'transparent' },
];

export default function ServiceScreen() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const saved = getDraft();
  const [service, setService] = useState<BreakdownType | null>(saved?.breakdownType ?? null);
  const [serviceFor, setServiceFor] = useState<ServiceFor>(saved?.serviceFor ?? 'self');
  const [contactName, setContactName] = useState(saved?.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(saved?.contactPhone ?? '');
  const [makeModel, setMakeModel] = useState(saved?.vehicleMakeModel ?? '');
  const [color, setColor] = useState(saved?.vehicleColor ?? '');
  const [registration, setRegistration] = useState(saved?.vehicleRegistration ?? '');
  const [passengers, setPassengers] = useState(saved?.passengers ?? 1);

  // An in-flight request should always land on the live map, not a blank form.
  useEffect(() => {
    let mounted = true;
    fetchActiveRequest()
      .then((row) => { if (mounted && row) router.replace('/(main)/client/map'); })
      .catch(() => { /* offline or none: stay on this screen */ });
    return () => { mounted = false; };
  }, [router]);

  const otherReady = serviceFor === 'self' || (contactName.trim().length > 1 && contactPhone.trim().length >= 7);
  const canContinue = !!service && otherReady;

  const hint = useMemo(() => {
    if (!service) return 'Choose a service to continue';
    if (!otherReady) return "Add the other person's name and phone";
    return 'Continue';
  }, [service, otherReady]);

  const next = () => {
    if (!service || !canContinue) return;
    setDraft({
      breakdownType: service,
      serviceFor,
      contactName: serviceFor === 'other' ? contactName.trim() : undefined,
      contactPhone: serviceFor === 'other' ? contactPhone.trim() : undefined,
      vehicleMakeModel: makeModel.trim() || undefined,
      vehicleColor: color || undefined,
      vehicleRegistration: registration.trim().toUpperCase() || undefined,
      passengers,
    });
    router.push('/(main)/client/map');
  };

  const sos = () => { void Linking.openURL('tel:112').catch(() => Alert.alert('Unable to place call', 'Call emergency services at 112.')); };
  const logout = async () => {
    setDraft(null);
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Could not sign out', error.message);
  };

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <TopBar inline onSos={sos} onLogout={() => { void logout(); }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={s.h1}>What do you need?</Text>
          <Text style={s.sub}>Tell us what happened so we can send the right help.</Text>

          <View style={s.grid}>
            {SERVICES.map((item) => {
              const on = service === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setService(item.id)}
                  style={[s.tile, on && s.tileOn]}
                >
                  <View style={[s.tileIcon, on && { backgroundColor: L.go }]}>
                    <MaterialCommunityIcons name={item.icon as any} size={24} color={on ? L.onGo : L.text} />
                  </View>
                  <Text style={s.tileTitle}>{item.label}</Text>
                  <Text style={s.tileBlurb} numberOfLines={2}>{item.blurb}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={s.h2}>Who is this for?</Text>
          <View style={s.segment}>
            {([['self', 'Me'], ['other', 'Someone else']] as const).map(([id, label]) => (
              <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: serviceFor === id }} onPress={() => setServiceFor(id)} style={[s.segBtn, serviceFor === id && s.segBtnOn]}>
                <Text style={[s.segText, serviceFor === id && s.segTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {serviceFor === 'other' && (
            <View style={s.fields}>
              <Field label="Their name" value={contactName} onChangeText={setContactName} placeholder="Full name" autoCapitalize="words" />
              <Field label="Their phone number" value={contactPhone} onChangeText={setContactPhone} placeholder="082 123 4567" keyboardType="phone-pad" />
            </View>
          )}

          <Text style={s.h2}>Your vehicle</Text>
          <Text style={s.helper}>Optional, but it helps your driver find you quickly.</Text>
          <View style={s.fields}>
            <Field label="Make & model" value={makeModel} onChangeText={setMakeModel} placeholder="e.g. Toyota Corolla" autoCapitalize="words" />
            <View>
              <Text style={s.label}>Colour</Text>
              <View style={s.swatches}>
                {COLORS.map((c) => {
                  const on = color === c.name;
                  return (
                    <Pressable key={c.name} accessibilityRole="button" accessibilityLabel={c.name} accessibilityState={{ selected: on }} onPress={() => setColor(on ? '' : c.name)} style={[s.swatchWrap, on && s.swatchWrapOn]}>
                      <View style={[s.swatch, { backgroundColor: c.hex }, c.name === 'Other' && s.swatchOther]}>
                        {c.name === 'Other' ? <Text style={s.swatchQ}>?</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={s.colorName}>{color || 'Tap a colour'}</Text>
            </View>
            <Field label="Registration" value={registration} onChangeText={(v) => setRegistration(v.toUpperCase())} placeholder="e.g. CA 123 456" autoCapitalize="characters" />
            <View style={s.stepRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>People in the vehicle</Text>
                <Text style={s.helperTight}>Including the driver</Text>
              </View>
              <View style={s.stepper}>
                <Pressable accessibilityRole="button" accessibilityLabel="Fewer people" onPress={() => setPassengers((n) => Math.max(1, n - 1))} style={s.stepBtn}><Text style={s.stepGlyph}>−</Text></Pressable>
                <Text style={s.stepValue}>{passengers}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="More people" onPress={() => setPassengers((n) => Math.min(12, n + 1))} style={s.stepBtn}><Text style={s.stepGlyph}>+</Text></Pressable>
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={[s.footer, { paddingBottom: bottom + 12 }]}>
          <Pressable accessibilityRole="button" disabled={!canContinue} onPress={next} style={[s.cta, !canContinue && s.ctaOff]}>
            <Text style={[s.ctaText, !canContinue && s.ctaTextOff]}>{hint}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput {...props} placeholderTextColor={L.disabledText} style={s.input} accessibilityLabel={label} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: L.bg },
  content: { padding: 20, paddingBottom: 28 },
  h1: { color: L.text, fontFamily: font.bold, fontSize: 30, letterSpacing: -0.8 },
  sub: { color: L.textMuted, fontFamily: font.medium, fontSize: 15, marginTop: 6, marginBottom: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '48%', flexGrow: 1, minHeight: 138, padding: 14, borderRadius: 18, backgroundColor: L.surfaceRaised, borderWidth: 2, borderColor: 'transparent' },
  tileOn: { borderColor: L.go, backgroundColor: L.goSoft },
  tileIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  tileTitle: { color: L.text, fontFamily: font.bold, fontSize: 15 },
  tileBlurb: { color: L.textMuted, fontFamily: font.medium, fontSize: 12, marginTop: 3, lineHeight: 16 },
  h2: { color: L.text, fontFamily: font.bold, fontSize: 20, letterSpacing: -0.3, marginTop: 28, marginBottom: 10 },
  helper: { color: L.textMuted, fontFamily: font.medium, fontSize: 13, marginTop: -4, marginBottom: 12 },
  helperTight: { color: L.textMuted, fontFamily: font.medium, fontSize: 12, marginTop: 2 },
  segment: { flexDirection: 'row', backgroundColor: L.surfaceRaised, borderRadius: 999, padding: 4 },
  segBtn: { flex: 1, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: L.go },
  segText: { color: L.text, fontFamily: font.semibold, fontSize: 15 },
  segTextOn: { color: L.onGo },
  fields: { gap: 14, marginTop: 14 },
  label: { color: L.text, fontFamily: font.semibold, fontSize: 13, marginBottom: 6 },
  input: { height: 52, borderRadius: 14, backgroundColor: L.surfaceRaised, paddingHorizontal: 16, color: L.text, fontFamily: font.medium, fontSize: 16 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatchWrap: { padding: 3, borderRadius: 999, borderWidth: 2, borderColor: 'transparent' },
  swatchWrapOn: { borderColor: L.go },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(17,24,39,0.18)', alignItems: 'center', justifyContent: 'center' },
  swatchOther: { backgroundColor: L.surfaceRaised },
  swatchQ: { color: L.textMuted, fontFamily: font.bold, fontSize: 15 },
  colorName: { color: L.textMuted, fontFamily: font.medium, fontSize: 12, marginTop: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: L.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  stepGlyph: { color: L.text, fontFamily: font.bold, fontSize: 22, lineHeight: 26 },
  stepValue: { minWidth: 24, textAlign: 'center', color: L.text, fontFamily: font.bold, fontSize: 20 },
  footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: '#FFFFFF', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: L.border },
  cta: { height: 54, borderRadius: 999, backgroundColor: L.go, alignItems: 'center', justifyContent: 'center' },
  ctaOff: { backgroundColor: L.disabled },
  ctaText: { color: L.onGo, fontFamily: font.bold, fontSize: 16 },
  ctaTextOff: { color: L.disabledText },
});
