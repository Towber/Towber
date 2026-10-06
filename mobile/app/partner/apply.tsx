import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';

import { supabase, type BreakdownType } from '../../src/api';
import { TOWBERPRO as PARTNER } from '../../src/copy';
import { setPartnerIntent } from '../../src/partnerIntent';
import {
  DOC_BUCKET, SERVICE_OPTIONS, docInfo, isWinchTow, STATUS_COPY, TIERS, TOW_VEHICLE_TYPES,
  optionalDocs, requiredDocs,
  type ApplicationStatus, type DocType, type PartnerTier, type TowVehicleType,
} from '../../src/partnerOnboarding';
import { font, light as L } from '../../src/theme';

type Application = {
  id: string;
  partner_tier: PartnerTier;
  capabilities: string[];
  business_name: string;
  company_registration_number: string | null;
  contact_phone: string;
  vehicle_registration: string;
  tow_vehicle_type: TowVehicleType | null;
  status: ApplicationStatus;
  review_notes: string | null;
};
type Doc = { id: string; document_type: DocType; object_path: string };

const APP_COLUMNS = 'id, partner_tier, capabilities, business_name, company_registration_number, contact_phone, vehicle_registration, tow_vehicle_type, status, review_notes';
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_BYTES = 10 * 1024 * 1024;
const STEPS = ['Services', 'Details', 'Documents', 'Review'];

const guessMime = (name?: string | null) => {
  const n = (name ?? '').toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  return '';
};

export default function PartnerApplyScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [app, setApp] = useState<Application | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [starting, setStarting] = useState(false); // wizard open for a new/draft application

  const [step, setStep] = useState(0);
  const [tier, setTier] = useState<PartnerTier | null>(null);
  const [capabilities, setCapabilities] = useState<BreakdownType[]>([]);
  const [businessName, setBusinessName] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleReg, setVehicleReg] = useState('');
  const [towType, setTowType] = useState<TowVehicleType | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyDoc, setBusyDoc] = useState<DocType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hydrate = useCallback((row: Application) => {
    setTier(row.partner_tier);
    setCapabilities(row.capabilities as BreakdownType[]);
    setBusinessName(row.business_name);
    setRegNumber(row.company_registration_number ?? '');
    setPhone(row.contact_phone);
    setVehicleReg(row.vehicle_registration);
    setTowType(row.tow_vehicle_type);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('partner_applications')
        .select(APP_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const row = (data as Application | null) ?? null;
      setApp(row);
      if (row) {
        hydrate(row);
        const { data: docRows, error: docError } = await supabase
          .from('partner_documents')
          .select('id, document_type, object_path')
          .eq('application_id', row.id);
        if (docError) throw docError;
        setDocs((docRows ?? []) as Doc[]);
        if (row.status === 'draft' || row.status === 'needs_info') { setStarting(true); setStep(2); }
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load your application.');
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => { void load(); }, [load]);

  const close = () => {
    void setPartnerIntent(false);
    if (router.canGoBack()) router.back(); else router.replace('/');
  };

  const signOut = async () => {
    await setPartnerIntent(false);
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) Alert.alert('Could not sign out', error.message);
  };

  // ---------- step 0: tier + services ----------
  const pickTier = (id: PartnerTier) => {
    setTier(id);
    setCapabilities(id === 'tow_operator' ? ['flatbed'] : []);
  };
  const toggleService = (id: BreakdownType) => {
    if (tier === 'tow_operator' && id === 'flatbed') return; // towing is what makes them a tow operator
    if (tier === 'roadside_responder' && id === 'flatbed') return;
    setCapabilities((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]));
  };
  const visibleServices = SERVICE_OPTIONS.filter((s) => tier === 'tow_operator' || s.id !== 'flatbed');
  const step0Ok = !!tier && capabilities.length > 0;

  // ---------- step 1: details ----------
  const step1Ok =
    businessName.trim().length >= 2 &&
    phone.replace(/\D/g, '').length >= 9 &&
    vehicleReg.trim().length >= 3 &&
    (tier !== 'tow_operator' || !!towType);

  const saveDetails = async () => {
    if (!tier || !step1Ok) return;
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error('You are signed out. Please sign in again.');
      const fields = {
        partner_tier: tier,
        capabilities,
        business_name: businessName.trim(),
        company_registration_number: regNumber.trim() || null,
        contact_phone: phone.trim(),
        vehicle_registration: vehicleReg.trim().toUpperCase(),
        tow_vehicle_type: tier === 'tow_operator' ? towType : null,
      };
      const query = app && (app.status === 'draft' || app.status === 'needs_info')
        ? supabase.from('partner_applications').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', app.id)
        : supabase.from('partner_applications').insert({ ...fields, user_id: userId });
      const { data, error } = await query.select(APP_COLUMNS).single();
      if (error) throw error;
      setApp(data as Application);
      setStep(2);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ---------- step 2: documents ----------
  const required = useMemo(() => (tier ? requiredDocs(tier, towType) : []), [tier, towType]);
  const optional = useMemo(() => (tier ? optionalDocs(tier, capabilities) : []), [tier, capabilities]);
  const hasDoc = (t: DocType) => docs.some((d) => d.document_type === t);
  const missing = required.filter((t) => !hasDoc(t));

  const uploadDoc = async (docType: DocType) => {
    if (!app || busyDoc) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: ALLOWED_MIME, copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const mime = ALLOWED_MIME.includes(asset.mimeType ?? '') ? (asset.mimeType as string) : guessMime(asset.name);
    if (!mime) { Alert.alert('Unsupported file', 'Please choose a PDF, JPG or PNG.'); return; }
    if (asset.size && asset.size > MAX_BYTES) { Alert.alert('File too large', 'Files must be 10 MB or smaller.'); return; }

    setBusyDoc(docType);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error('You are signed out. Please sign in again.');
      const bytes = await (await fetch(asset.uri)).arrayBuffer();
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) throw new Error('That file is empty or larger than 10 MB.');
      const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
      const path = `${userId}/${app.id}/${docType}-${Date.now()}.${ext}`;

      const up = await supabase.storage.from(DOC_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error) throw up.error;
      const ins = await supabase
        .from('partner_documents')
        .insert({ application_id: app.id, submitted_by: userId, document_type: docType, object_path: path, content_type: mime, file_size_bytes: bytes.byteLength })
        .select('id, document_type, object_path')
        .single();
      if (ins.error) {
        await supabase.storage.from(DOC_BUCKET).remove([path]);
        throw ins.error;
      }
      // Replace an earlier upload of the same type.
      const previous = docs.filter((d) => d.document_type === docType);
      for (const old of previous) {
        await supabase.from('partner_documents').delete().eq('id', old.id);
        await supabase.storage.from(DOC_BUCKET).remove([old.object_path]);
      }
      setDocs((cur) => [...cur.filter((d) => d.document_type !== docType), ins.data as Doc]);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusyDoc(null);
    }
  };

  // ---------- step 3: submit ----------
  const submit = async () => {
    if (!app || submitting) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('submit_partner_application', { p_application_id: app.id });
      if (error) {
        if (error.message.includes('missing_documents')) {
          const names = (error.message.split('missing_documents:')[1] ?? '').split(',')
            .map((c) => docInfo(c.trim() as DocType, towType)?.label ?? c.trim()).filter(Boolean);
          throw new Error(`Please upload: ${names.join(', ')}`);
        }
        throw error;
      }
      setStarting(false);
      await load();
    } catch (e) {
      Alert.alert('Could not submit', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const startNew = () => {
    setApp(null); setDocs([]); setTier(null); setCapabilities([]); setBusinessName('');
    setRegNumber(''); setPhone(''); setVehicleReg(''); setTowType(null);
    setStep(0); setStarting(true);
  };

  // ---------- render ----------
  if (loading) {
    return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color={L.go} size="large" /></View></SafeAreaView>;
  }
  if (loadError) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <Text style={[s.h1, s.tc]}>Could not load</Text>
          <Text style={[s.body, s.tc]}>{loadError}</Text>
          <Pressable accessibilityRole="button" onPress={() => { void load(); }} style={s.primary}><Text style={s.primaryText}>Try again</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={close} style={s.linkBtn}><Text style={s.linkText}>Close</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Status view: submitted / approved / rejected (draft + needs_info use the wizard).
  if (app && !starting) {
    const copy = STATUS_COPY[app.status];
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={s.center}>
          <View style={[s.statusIcon, app.status === 'approved' && { backgroundColor: L.go }]}>
            <Ionicons
              name={app.status === 'approved' ? 'checkmark' : app.status === 'rejected' ? 'close' : 'time-outline'}
              size={30}
              color={app.status === 'approved' ? L.onGo : L.text}
            />
          </View>
          <Text style={[s.h1, s.tc]}>{copy.title}</Text>
          <Text style={[s.body, s.tc]}>{copy.body}</Text>
          {app.review_notes ? <View style={s.note}><Text style={s.noteLabel}>Reviewer note</Text><Text style={s.noteText}>{app.review_notes}</Text></View> : null}
          {app.status === 'approved' ? (
            <Pressable accessibilityRole="button" onPress={() => { void signOut(); }} style={s.primary}><Text style={s.primaryText}>Sign out and open {PARTNER.Singular} app</Text></Pressable>
          ) : app.status === 'rejected' ? (
            <Pressable accessibilityRole="button" onPress={startNew} style={s.primary}><Text style={s.primaryText}>Start a new application</Text></Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={close} style={s.linkBtn}><Text style={s.linkText}>Close</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // First visit: short intro before the wizard.
  if (!app && !starting) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={s.center}>
          <View style={s.statusIcon}><MaterialCommunityIcons name="handshake-outline" size={30} color={L.text} /></View>
          <Text style={[s.h1, s.tc]}>Become a {PARTNER.singular}</Text>
          <Text style={[s.body, s.tc]}>Choose the services you offer, upload your documents, and our team will verify you. You can save and come back any time.</Text>
          <Pressable accessibilityRole="button" onPress={() => { setStep(0); setStarting(true); }} style={s.primary}><Text style={s.primaryText}>Start application</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={close} style={s.linkBtn}><Text style={s.linkText}>Not now</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const canNext = step === 0 ? step0Ok : step === 1 ? step1Ok : step === 2 ? missing.length === 0 : true;
  const goBack = () => { if (step === 0) close(); else setStep(step - 1); };
  const goNext = () => {
    if (step === 1) { void saveDetails(); return; }
    if (step === 3) { void submit(); return; }
    setStep(step + 1);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={s.topRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} hitSlop={10} style={s.iconBtn}>
          <Ionicons name={step === 0 ? 'close' : 'chevron-back'} size={22} color={L.text} />
        </Pressable>
        <Text style={s.stepLabel}>Step {step + 1} of {STEPS.length} · {STEPS[step]}</Text>
        <View style={s.iconBtn} />
      </View>
      <View style={s.progress}>{STEPS.map((_, i) => <View key={i} style={[s.progressBar, i <= step && s.progressOn]} />)}</View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {app?.status === 'needs_info' && app.review_notes ? (
            <View style={s.note}><Text style={s.noteLabel}>Reviewer note</Text><Text style={s.noteText}>{app.review_notes}</Text></View>
          ) : null}

          {step === 0 && (
            <>
              <Text style={s.h1}>What do you do?</Text>
              <Text style={s.body}>Pick the option that fits you best, then the services you offer. You will only receive jobs for the services you choose.</Text>
              <View style={s.tierRow}>
                {TIERS.map((t) => {
                  const on = tier === t.id;
                  return (
                    <Pressable key={t.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => pickTier(t.id)} style={[s.tier, on && s.tierOn]}>
                      <View style={[s.tierIcon, on && { backgroundColor: L.go }]}><MaterialCommunityIcons name={t.icon as any} size={24} color={on ? L.onGo : L.text} /></View>
                      <Text style={s.tierTitle}>{t.title}</Text>
                      <Text style={s.tierBlurb}>{t.blurb}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {tier ? (
                <>
                  <Text style={s.h2}>Services you offer</Text>
                  <View style={s.chips}>
                    {visibleServices.map((svc) => {
                      const on = capabilities.includes(svc.id);
                      const locked = svc.id === 'flatbed';
                      return (
                        <Pressable key={svc.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => toggleService(svc.id)} style={[s.chip, on && s.chipOn]}>
                          <MaterialCommunityIcons name={svc.icon as any} size={18} color={on ? L.onGo : L.text} />
                          <Text style={[s.chipText, on && { color: L.onGo }]}>{svc.label}{locked ? ' ✓' : ''}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </>
          )}

          {step === 1 && (
            <>
              <Text style={s.h1}>Your details</Text>
              <Text style={s.body}>Use the name customers will see.</Text>
              <View style={s.fields}>
                <Field label={tier === 'tow_operator' ? 'Company / trading name' : 'Your name or trading name'} value={businessName} onChangeText={setBusinessName} placeholder="e.g. Sipho's Roadside" autoCapitalize="words" />
                <Field label="Company registration number (if any)" value={regNumber} onChangeText={setRegNumber} placeholder="e.g. 2019/123456/07" autoCapitalize="characters" />
                <Field label="Contact phone" value={phone} onChangeText={setPhone} placeholder="082 123 4567" keyboardType="phone-pad" />
                <Field label="Vehicle registration" value={vehicleReg} onChangeText={(v) => setVehicleReg(v.toUpperCase())} placeholder="e.g. CA 123 456" autoCapitalize="characters" />
                {tier === 'tow_operator' ? (
                  <View>
                    <Text style={s.label}>Tow vehicle type</Text>
                    <View style={s.chips}>
                      {TOW_VEHICLE_TYPES.map((t) => {
                        const on = towType === t.id;
                        return (
                          <Pressable key={t.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setTowType(t.id)} style={[s.chip, on && s.chipOn]}>
                            <Text style={[s.chipText, on && { color: L.onGo }]}>{t.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={s.h1}>Upload documents</Text>
              <Text style={s.body}>PDF, JPG or PNG, up to 10 MB each. Only our verification team can see these.</Text>
              <Text style={s.h2}>Required</Text>
              {tier === 'tow_operator' && isWinchTow(towType) ? <Text style={s.body}>Winch Bakkie / Sling Tow: upload your Code 8/10 PrDP, vehicle registration, GIT insurance and winch setup photos.</Text> : null}
              {required.map((t) => <DocRow key={t} type={t} towType={towType} done={hasDoc(t)} busy={busyDoc === t} onPress={() => { void uploadDoc(t); }} />)}
              {optional.length > 0 ? <Text style={s.h2}>Optional</Text> : null}
              {optional.map((t) => <DocRow key={t} type={t} towType={towType} done={hasDoc(t)} busy={busyDoc === t} onPress={() => { void uploadDoc(t); }} />)}
            </>
          )}

          {step === 3 && (
            <>
              <Text style={s.h1}>Review and submit</Text>
              <View style={s.summary}>
                <SummaryRow label="Type" value={TIERS.find((t) => t.id === tier)?.title ?? ''} />
                <SummaryRow label="Services" value={capabilities.map((c) => SERVICE_OPTIONS.find((o) => o.id === c)?.label ?? c).join(', ')} />
                <SummaryRow label="Name" value={businessName} />
                <SummaryRow label="Phone" value={phone} />
                <SummaryRow label="Vehicle" value={vehicleReg} />
                <SummaryRow label="Documents" value={`${docs.length} uploaded`} />
              </View>
              <Text style={s.body}>After you submit, our team verifies your documents. You will be able to take jobs once you are approved and your prices are set up.</Text>
            </>
          )}
        </ScrollView>

        <View style={s.footer}>
          <Pressable accessibilityRole="button" disabled={!canNext || saving || submitting} onPress={goNext} style={[s.primary, (!canNext || saving || submitting) && s.primaryOff, { alignSelf: 'stretch', marginTop: 0 }]}>
            {saving || submitting ? <ActivityIndicator color={L.onGo} /> : (
              <Text style={[s.primaryText, !canNext && { color: L.disabledText }]}>
                {step === 3 ? 'Submit application' : step === 2 && missing.length > 0 ? `${missing.length} required document${missing.length === 1 ? '' : 's'} left` : 'Continue'}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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

function DocRow({ type, towType, done, busy, onPress }: { type: DocType; towType?: TowVehicleType | null; done: boolean; busy: boolean; onPress: () => void }) {
  const info = docInfo(type, towType);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${done ? 'Replace' : 'Upload'} ${info.label}`} disabled={busy} onPress={onPress} style={[s.doc, done && s.docDone]}>
      <View style={[s.docIcon, done && { backgroundColor: L.go }]}>
        {busy ? <ActivityIndicator color={L.text} /> : <Ionicons name={done ? 'checkmark' : 'cloud-upload-outline'} size={20} color={done ? L.onGo : L.text} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.docTitle}>{info.label}</Text>
        <Text style={s.docHelp}>{done ? 'Uploaded · tap to replace' : info.help}</Text>
      </View>
    </Pressable>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.sumRow}>
      <Text style={s.sumLabel}>{label}</Text>
      <Text style={s.sumValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: L.bg },
  tc: { textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 6 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { color: L.textMuted, fontFamily: font.semibold, fontSize: 13 },
  progress: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, marginTop: 6 },
  progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: L.disabled },
  progressOn: { backgroundColor: L.go },
  content: { padding: 20, paddingBottom: 28 },
  h1: { color: L.text, fontFamily: font.bold, fontSize: 28, letterSpacing: -0.7, textAlign: 'left' },
  h2: { color: L.text, fontFamily: font.bold, fontSize: 18, marginTop: 24, marginBottom: 10 },
  body: { color: L.textMuted, fontFamily: font.medium, fontSize: 15, lineHeight: 22, marginTop: 6 },
  tierRow: { gap: 12, marginTop: 18 },
  tier: { padding: 16, borderRadius: 18, backgroundColor: L.surfaceRaised, borderWidth: 2, borderColor: 'transparent' },
  tierOn: { borderColor: L.go, backgroundColor: L.goSoft },
  tierIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  tierTitle: { color: L.text, fontFamily: font.bold, fontSize: 17 },
  tierBlurb: { color: L.textMuted, fontFamily: font.medium, fontSize: 13, marginTop: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 44, borderRadius: 999, backgroundColor: L.surfaceRaised },
  chipOn: { backgroundColor: L.go },
  chipText: { color: L.text, fontFamily: font.semibold, fontSize: 14 },
  fields: { gap: 14, marginTop: 18 },
  label: { color: L.text, fontFamily: font.semibold, fontSize: 13, marginBottom: 6 },
  input: { height: 52, borderRadius: 14, backgroundColor: L.surfaceRaised, paddingHorizontal: 16, color: L.text, fontFamily: font.medium, fontSize: 16 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: L.surfaceRaised, marginBottom: 10 },
  docDone: { backgroundColor: L.goSoft },
  docIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  docTitle: { color: L.text, fontFamily: font.semibold, fontSize: 14 },
  docHelp: { color: L.textMuted, fontFamily: font.medium, fontSize: 12, marginTop: 2 },
  summary: { marginTop: 14, padding: 16, borderRadius: 16, backgroundColor: L.surfaceRaised, gap: 10 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  sumLabel: { color: L.textMuted, fontFamily: font.medium, fontSize: 14 },
  sumValue: { flex: 1, textAlign: 'right', color: L.text, fontFamily: font.semibold, fontSize: 14 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: L.border, backgroundColor: '#FFFFFF' },
  primary: { minHeight: 54, paddingHorizontal: 24, borderRadius: 999, backgroundColor: L.go, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  primaryOff: { backgroundColor: L.disabled },
  primaryText: { color: L.onGo, fontFamily: font.bold, fontSize: 16 },
  linkBtn: { padding: 10 },
  linkText: { color: L.textMuted, fontFamily: font.semibold, fontSize: 14 },
  statusIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: L.surfaceRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  note: { alignSelf: 'stretch', padding: 14, borderRadius: 14, backgroundColor: 'rgba(180,83,9,0.08)', marginBottom: 12, gap: 4 },
  noteLabel: { color: L.warn, fontFamily: font.bold, fontSize: 12 },
  noteText: { color: L.text, fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
});
