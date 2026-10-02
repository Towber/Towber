import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { supabase, isTerminalRequestStatus, transitionRequest, type RequestAction, type RequestStatus } from '../../../src/api';
import { startDriverLocationStream } from '../../../src/driverLocation';
import { colors, darkMapStyle, font, radius, zar } from '../../../src/theme';

type BreakdownType = 'flatbed' | 'jumpstart' | 'lockout' | 'fuel' | 'tyre' | 'repair';
type JobAlert = {
  id: string;
  breakdownType: BreakdownType;
  distanceKm: number;
  quotedPrice: number;
  status: RequestStatus;
  expiresAt: string | null;
  vehicle: string | null;
  registration: string | null;
  passengers: number | null;
  contact: string | null;
};

const JHB = { latitude: -26.2041, longitude: 28.0473, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const SERVICE_LABEL: Record<BreakdownType, string> = {
  flatbed: 'Towing & recovery', jumpstart: 'Jump start', lockout: 'Lockout', fuel: 'Fuel delivery', tyre: 'Tyre change', repair: 'Minor repairs',
};
const BREAKDOWN_TYPES: BreakdownType[] = ['flatbed', 'jumpstart', 'lockout', 'fuel', 'tyre', 'repair'];
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const KNOWN_STATUSES: RequestStatus[] = ['pending', 'accepted', 'en_route', 'arrived', 'completed', 'cancelled', 'declined', 'expired'];
const OPEN_STATUSES: RequestStatus[] = ['pending', 'accepted', 'en_route', 'arrived'];
const STATUS_HEADLINE: Record<string, { eyebrow: string; title: string }> = {
  pending: { eyebrow: 'NEW JOB ALERT', title: 'Tow request assigned' },
  accepted: { eyebrow: 'JOB ACCEPTED', title: 'Head to the pickup point' },
  en_route: { eyebrow: 'EN ROUTE', title: 'Driving to the pickup' },
  arrived: { eyebrow: 'ARRIVED', title: 'At the breakdown scene' },
};
const NEXT_STEP: Partial<Record<RequestStatus, { action: RequestAction; label: string }>> = {
  accepted: { action: 'en_route', label: 'Start driving' },
  en_route: { action: 'arrived', label: "I've arrived" },
  arrived: { action: 'completed', label: 'Complete job' },
};

function mapJob(row: Record<string, unknown>): JobAlert | null {
  if (typeof row.id !== 'string') return null;
  const value = row.breakdown_type;
  const breakdownType: BreakdownType = BREAKDOWN_TYPES.includes(value as BreakdownType) ? (value as BreakdownType) : 'flatbed';
  const vehicle = [text(row.vehicle_color), text(row.vehicle_make_model)].filter(Boolean).join(' ') || null;
  const contact = row.service_for === 'other' ? [text(row.contact_name), text(row.contact_phone)].filter(Boolean).join(' · ') || null : null;
  const status: RequestStatus = KNOWN_STATUSES.includes(row.status as RequestStatus)
    ? (row.status as RequestStatus)
    : 'pending';
  return {
    id: row.id,
    breakdownType,
    distanceKm: Number(row.estimated_distance_km) || 0,
    quotedPrice: Number(row.estimated_price_min) || 0,
    status,
    expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
    vehicle,
    registration: text(row.vehicle_registration),
    passengers: typeof row.passengers === 'number' ? row.passengers : null,
    contact,
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
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());

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
      if (!active || !alert) return;
      if (isTerminalRequestStatus(alert.status)) {
        // Closed elsewhere (motorist cancelled, dispatch expired, …).
        setJobAlert((previous) => (previous && previous.id === alert.id ? null : previous));
        return;
      }
      setJobAlert((previous) => {
        if (!previous || previous.id === alert.id) return alert;
        // A newer pending offer wins; an active job is never replaced.
        if (previous.status === 'pending' && alert.status === 'pending') return alert;
        return previous;
      });
    };

    // Load an outstanding offer or active job after subscribing, so opening
    // the app late does not miss a pending request or an in-progress job for
    // this driver's assigned vehicle.
    void supabase
      .from('tow_requests')
      .select('id, status, expires_at, breakdown_type, estimated_distance_km, estimated_price_min, service_for, contact_name, contact_phone, vehicle_make_model, vehicle_color, vehicle_registration, passengers')
      .eq('assigned_vehicle_id', vehicleId)
      .in('status', OPEN_STATUSES)
      .order('created_at', { ascending: false })
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
          event: '*', schema: 'public', table: 'tow_requests',
          filter: `assigned_vehicle_id=eq.${vehicleId}`,
        }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string } | null)?.id;
            if (active && oldId) {
              setJobAlert((previous) => (previous && previous.id === oldId ? null : previous));
            }
            return;
          }
          receive(payload.new as Record<string, unknown>);
        })
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

  // Offer countdown while a request is still pending.
  useEffect(() => {
    if (jobAlert?.status !== 'pending') return;
    setClockMs(Date.now());
    const timer = setInterval(() => setClockMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [jobAlert?.status, jobAlert?.id]);

  const offerSecondsLeft = jobAlert?.status === 'pending'
    ? jobAlert.expiresAt
      ? Math.max(0, Math.ceil((new Date(jobAlert.expiresAt).getTime() - clockMs) / 1000))
      : 90
    : 0;

  // Accept / decline / en route / arrived / complete — the API owns the state
  // machine, so a stale or raced action simply resolves to a 403/409 here.
  const runAction = async (action: RequestAction) => {
    if (!jobAlert || acting) return;
    setActing(true);
    setActionError(null);
    try {
      const updated = await transitionRequest(jobAlert.id, action);
      if (action === 'decline' || isTerminalRequestStatus(updated.status)) {
        setJobAlert(null);
        if (action === 'completed') {
          Alert.alert('Job completed', 'The request is closed. Nice work.');
        }
        return;
      }
      setJobAlert({ ...jobAlert, status: updated.status, expiresAt: updated.expires_at ?? null });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 403 || status === 404 || status === 409) {
        // Offer expired, was reassigned, or the request closed elsewhere.
        setJobAlert(null);
        return;
      }
      setActionError(error instanceof Error ? error.message : 'Could not update the request. Try again.');
    } finally {
      setActing(false);
    }
  };

  const headline = (jobAlert && STATUS_HEADLINE[jobAlert.status]) ?? STATUS_HEADLINE.pending;
  const nextStep = jobAlert ? NEXT_STEP[jobAlert.status] : undefined;
  const offerPending = jobAlert?.status === 'pending';

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
            <View style={styles.alertIcon}><Ionicons name={offerPending ? 'notifications' : 'navigate'} size={23} color={colors.bg} /></View>
            <Text style={styles.alertEyebrow}>{headline.eyebrow}</Text>
            <Text style={styles.alertTitle}>{headline.title}</Text>
            {jobAlert && (
              <>
                <View style={styles.jobRow}><Text style={styles.jobLabel}>Service</Text><Text style={styles.jobValue}>{SERVICE_LABEL[jobAlert.breakdownType]}</Text></View>
                {jobAlert.vehicle ? <View style={styles.jobRow}><Text style={styles.jobLabel}>Vehicle</Text><Text style={styles.jobValue}>{jobAlert.vehicle}</Text></View> : null}
                {jobAlert.registration ? <View style={styles.jobRow}><Text style={styles.jobLabel}>Registration</Text><Text style={styles.jobValue}>{jobAlert.registration}</Text></View> : null}
                {jobAlert.passengers != null ? <View style={styles.jobRow}><Text style={styles.jobLabel}>People in vehicle</Text><Text style={styles.jobValue}>{jobAlert.passengers}</Text></View> : null}
                {jobAlert.contact ? <View style={styles.jobRow}><Text style={styles.jobLabel}>Requested for</Text><Text style={styles.jobValue}>{jobAlert.contact}</Text></View> : null}
                {jobAlert.breakdownType === 'flatbed' ? <View style={styles.jobRow}><Text style={styles.jobLabel}>Estimated distance</Text><Text style={styles.jobValue}>{jobAlert.distanceKm.toFixed(1)} km</Text></View> : null}
                <View style={styles.jobRow}><Text style={styles.jobLabel}>Quoted fare</Text><Text style={styles.jobValue}>{zar(jobAlert.quotedPrice)}</Text></View>
                <Text style={styles.jobRef}>Request {jobAlert.id.slice(0, 8).toUpperCase()}</Text>
              </>
            )}
            {offerPending && (
              <Text style={styles.offerTimer}>
                {offerSecondsLeft > 0
                  ? `Offer expires in ${Math.floor(offerSecondsLeft / 60)}:${String(offerSecondsLeft % 60).padStart(2, '0')}`
                  : 'Offer expired · waiting for a dispatch update'}
              </Text>
            )}
            {actionError && <Text style={styles.actionError}>{actionError}</Text>}
            {offerPending ? (
              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Accept tow request"
                  disabled={acting || offerSecondsLeft <= 0}
                  onPress={() => { void runAction('accept'); }}
                  style={[styles.acceptButton, (acting || offerSecondsLeft <= 0) && styles.buttonOff]}
                >
                  {acting ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.acceptText}>Accept job</Text>}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Decline tow request"
                  disabled={acting}
                  onPress={() => { void runAction('decline'); }}
                  style={[styles.declineButton, acting && styles.buttonOff]}
                >
                  <Text style={styles.declineText}>Decline</Text>
                </Pressable>
              </View>
            ) : nextStep ? (
              <Pressable
                accessibilityRole="button"
                disabled={acting}
                onPress={() => { void runAction(nextStep.action); }}
                style={[styles.ackButton, acting && styles.buttonOff]}
              >
                {acting ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.ackText}>{nextStep.label}</Text>}
              </Pressable>
            ) : null}
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
  offerTimer: { color: colors.warn, fontFamily: font.semibold, fontSize: 12 },
  actionError: { color: colors.warn, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  acceptButton: { flex: 1, height: 50, borderRadius: 15, backgroundColor: colors.go, alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: colors.bg, fontFamily: font.bold, fontSize: 15 },
  declineButton: { flex: 1, height: 50, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  declineText: { color: colors.text, fontFamily: font.semibold, fontSize: 15 },
  buttonOff: { opacity: 0.55 },
  ackButton: { height: 50, borderRadius: 15, backgroundColor: colors.go, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  ackText: { color: colors.bg, fontFamily: font.bold, fontSize: 15 },
});
