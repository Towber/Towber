import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../../../src/api';
import { startDriverLocationStream } from '../../../src/driverLocation';
import { colors, darkMapStyle, font, radius, zar } from '../../../src/theme';

type BreakdownType = 'flatbed' | 'jumpstart' | 'lockout';
type JobAlert = { id: string; breakdownType: BreakdownType; distanceKm: number; quotedPrice: number };

const JHB = { latitude: -26.2041, longitude: 28.0473, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const SERVICE_LABEL: Record<BreakdownType, string> = { flatbed: 'Flatbed', jumpstart: 'Jumpstart', lockout: 'Lockout' };

function mapJob(row: Record<string, unknown>): JobAlert | null {
  if (typeof row.id !== 'string') return null;
  const value = row.breakdown_type;
  const breakdownType: BreakdownType = value === 'jumpstart' || value === 'lockout' ? value : 'flatbed';
  return {
    id: row.id,
    breakdownType,
    distanceKm: Number(row.estimated_distance_km) || 0,
    quotedPrice: Number(row.estimated_price_min) || 0,
  };
}

export default function DriverRoute() {
  const { top } = useSafeAreaInsets();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(true);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [jobAlert, setJobAlert] = useState<JobAlert | null>(null);

  const loadAssignment = useCallback(async () => {
    setAssignmentLoading(true);
    setAssignmentError(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const user = sessionData.session?.user;
      if (!user) throw new Error('No signed-in driver session was found.');
      const { data, error } = await supabase
        .from('vehicle_driver_assignments')
        .select('vehicle_id')
        .eq('driver_user_id', user.id)
        .is('revoked_at', null)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data?.vehicle_id) {
        setVehicleId(null);
        setAssignmentError('Ask your fleet manager to assign a vehicle before going online.');
      } else {
        setVehicleId(data.vehicle_id);
      }
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : 'Could not load your vehicle assignment.');
    } finally {
      setAssignmentLoading(false);
    }
  }, []);

  useEffect(() => { void loadAssignment(); }, [loadAssignment]);

  useEffect(() => {
    if (!online || !vehicleId) return;
    let active = true;
    let stopStream: (() => void) | undefined;
    setLocationError(null);
    void startDriverLocationStream(vehicleId, (error) => {
      if (active) setLocationError(error.message);
    })
      .then((stop) => {
        if (active) stopStream = stop;
        else stop();
      })
      .catch((error: unknown) => {
        if (!active) return;
        setOnline(false);
        setLocationError(error instanceof Error ? error.message : 'Could not start driver location sharing.');
      });
    return () => {
      active = false;
      stopStream?.();
    };
  }, [online, vehicleId]);

  useEffect(() => {
    if (!online || !vehicleId) return;
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    const receive = (row: Record<string, unknown>) => {
      const alert = mapJob(row);
      if (active && alert) setJobAlert(alert);
    };

    // Load an outstanding offer after subscribing, so opening the app late does
    // not miss an already-created request for this driver's assigned vehicle.
    void supabase
      .from('tow_requests')
      .select('id, breakdown_type, estimated_distance_km, estimated_price_min')
      .eq('assigned_vehicle_id', vehicleId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (active && !error && data) receive(data as Record<string, unknown>);
      });

    void (async () => {
      const { data: sessionData, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!active || !sessionData.session) return;
      await supabase.realtime.setAuth(sessionData.session.access_token);
      if (!active) return;
      channel = supabase
        .channel(`driver-job:${vehicleId}`, { config: { private: true } })
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'tow_requests',
          filter: `assigned_vehicle_id=eq.${vehicleId}`,
        }, (payload) => receive(payload.new as Record<string, unknown>))
        .subscribe();
    })().catch((error: unknown) => {
      if (active) setLocationError(error instanceof Error ? error.message : 'Could not connect to job alerts.');
    });

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [online, vehicleId]);

  const changeOnline = (value: boolean) => {
    if (value && !vehicleId) {
      Alert.alert('Vehicle required', 'Your fleet manager must assign a vehicle before you can go online.');
      return;
    }
    setJobAlert(null);
    setOnline(value);
  };

  const switchAccount = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Could not sign out', error.message);
  };

  return (
    <View style={styles.root}>
      <MapView
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={darkMapStyle}
        userInterfaceStyle="dark"
        showsUserLocation={online}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        initialRegion={JHB}
      />

      <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: top + 12 }]}>
        <View style={styles.statusCard}>
          <View style={styles.statusCopy}>
            <Text style={styles.eyebrow}>DRIVER MODE</Text>
            <Text style={styles.title}>{online ? 'You’re online' : 'You’re offline'}</Text>
            <Text style={styles.subtitle}>
              {assignmentLoading ? 'Checking your vehicle…' : vehicleId ? `Vehicle ${vehicleId.slice(0, 8).toUpperCase()}` : assignmentError}
            </Text>
          </View>
          {assignmentLoading ? <ActivityIndicator color={colors.go} /> : (
            <View style={styles.switchGroup}>
              <Text style={[styles.switchLabel, online && { color: colors.go }]}>{online ? 'Online' : 'Offline'}</Text>
              <Switch
                value={online}
                onValueChange={changeOnline}
                disabled={!vehicleId}
                trackColor={{ false: colors.surfaceRaised, true: 'rgba(0,230,118,0.45)' }}
                thumbColor={online ? colors.go : colors.textMuted}
                accessibilityLabel={`Driver status ${online ? 'online' : 'offline'}`}
              />
            </View>
          )}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Sign out and switch account" onPress={() => { void switchAccount(); }} style={styles.signOutButton}>
          <Ionicons name="log-out-outline" size={15} color={colors.textMuted} />
          <Text style={styles.signOutText}>Switch account</Text>
        </Pressable>
        {locationError && <View style={styles.errorCard}><Ionicons name="warning-outline" size={17} color={colors.warn} /><Text style={styles.errorText}>{locationError}</Text></View>}
        {online && <View style={styles.onlinePill}><View style={styles.onlineDot} /><Text style={styles.onlinePillText}>Sharing location · waiting for jobs</Text></View>}
        {!vehicleId && !assignmentLoading && (
          <Pressable accessibilityRole="button" onPress={() => void loadAssignment()} style={styles.retryButton}>
            <Text style={styles.retryText}>Refresh assignment</Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={!!jobAlert}
        transparent
        animationType="fade"
        onRequestClose={() => setJobAlert(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.alertCard}>
            <View style={styles.alertIcon}><Ionicons name="notifications" size={23} color={colors.bg} /></View>
            <Text style={styles.alertEyebrow}>NEW JOB ALERT</Text>
            <Text style={styles.alertTitle}>Tow request assigned</Text>
            {jobAlert && (
              <>
                <View style={styles.jobRow}><Text style={styles.jobLabel}>Service</Text><Text style={styles.jobValue}>{SERVICE_LABEL[jobAlert.breakdownType]}</Text></View>
                <View style={styles.jobRow}><Text style={styles.jobLabel}>Estimated distance</Text><Text style={styles.jobValue}>{jobAlert.distanceKm.toFixed(1)} km</Text></View>
                <View style={styles.jobRow}><Text style={styles.jobLabel}>Quoted fare</Text><Text style={styles.jobValue}>{zar(jobAlert.quotedPrice)}</Text></View>
                <Text style={styles.jobRef}>Request {jobAlert.id.slice(0, 8).toUpperCase()}</Text>
              </>
            )}
            <Pressable accessibilityRole="button" onPress={() => setJobAlert(null)} style={styles.ackButton}>
              <Text style={styles.ackText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  overlay: { ...StyleSheet.absoluteFill, paddingHorizontal: 16, gap: 10 },
  statusCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 18, borderRadius: radius.card, backgroundColor: 'rgba(15,23,42,0.94)', borderWidth: 1, borderColor: colors.border },
  signOutButton: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(15,23,42,0.94)' },
  signOutText: { color: colors.textMuted, fontFamily: font.semibold, fontSize: 12 },
  statusCopy: { flex: 1, gap: 4 },
  eyebrow: { color: colors.route, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.4 },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 19 },
  subtitle: { color: colors.textMuted, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  switchGroup: { alignItems: 'center', gap: 3 },
  switchLabel: { color: colors.textMuted, fontFamily: font.semibold, fontSize: 12 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, backgroundColor: 'rgba(15,23,42,0.92)' },
  errorText: { flex: 1, color: colors.warn, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  onlinePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: 'rgba(15,23,42,0.94)' },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.go },
  onlinePillText: { color: colors.text, fontFamily: font.medium, fontSize: 12 },
  retryButton: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surfaceRaised },
  retryText: { color: colors.text, fontFamily: font.semibold, fontSize: 12 },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(2,6,23,0.75)' },
  alertCard: { width: '100%', padding: 22, borderRadius: 24, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, gap: 12 },
  alertIcon: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.go, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  alertEyebrow: { color: colors.go, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.4 },
  alertTitle: { color: colors.text, fontFamily: font.bold, fontSize: 21, marginBottom: 4 },
  jobRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  jobLabel: { color: colors.textMuted, fontFamily: font.medium, fontSize: 13 },
  jobValue: { color: colors.text, fontFamily: font.semibold, fontSize: 14 },
  jobRef: { color: colors.textMuted, fontFamily: font.medium, fontSize: 11, marginTop: 3 },
  ackButton: { height: 50, borderRadius: 15, backgroundColor: colors.go, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  ackText: { color: colors.bg, fontFamily: font.bold, fontSize: 15 },
});
