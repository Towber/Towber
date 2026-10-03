import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { supabase, isTerminalRequestStatus, transitionRequest, type RequestAction, type RequestStatus } from '../../../src/api';
import { startDriverLocationStream } from '../../../src/driverLocation';
import { PARTNER } from '../../../src/copy';
import { font, light as L, lightMapStyle, zar } from '../../../src/theme';

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
  pickup: { latitude: number; longitude: number } | null;
};

const JHB = { latitude: -26.2041, longitude: 28.0473, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const SERVICE_LABEL: Record<BreakdownType, string> = {
  flatbed: 'Towing & recovery', jumpstart: 'Jump start', lockout: 'Lockout', fuel: 'Fuel delivery', tyre: 'Tyre change', repair: 'Minor repairs',
};
const BREAKDOWN_TYPES: BreakdownType[] = ['flatbed', 'jumpstart', 'lockout', 'fuel', 'tyre', 'repair'];
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
function pickupCoordinate(value: unknown) {
  if (value && typeof value === 'object' && 'coordinates' in value) {
    const coordinates = (value as { coordinates?: unknown }).coordinates;
    if (Array.isArray(coordinates) && Number.isFinite(Number(coordinates[0])) && Number.isFinite(Number(coordinates[1]))) {
      return { latitude: Number(coordinates[1]), longitude: Number(coordinates[0]) };
    }
  }
  if (typeof value === 'string') {
    const match = value.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
    if (match) return { latitude: Number(match[2]), longitude: Number(match[1]) };
  }
  return null;
}
const KNOWN_STATUSES: RequestStatus[] = ['pending', 'accepted', 'en_route', 'arrived', 'completed', 'cancelled', 'declined', 'expired'];
const OPEN_STATUSES: RequestStatus[] = ['pending', 'accepted', 'en_route', 'arrived'];
const STATUS_HEADLINE: Record<string, { eyebrow: string; title: string }> = {
  pending: { eyebrow: 'NEW JOB REQUEST', title: 'A request needs you' },
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
    pickup: pickupCoordinate(row.pickup_location),
  };
}

export default function PartnerRoute() {
  const { top, bottom } = useSafeAreaInsets();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(true);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [jobAlert, setJobAlert] = useState<JobAlert | null>(null);
  const [acceptedJobCollapsed, setAcceptedJobCollapsed] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const map = useRef<MapView>(null);

  const loadAssignment = useCallback(async () => {
    setAssignmentLoading(true);
    setAssignmentError(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const user = sessionData.session?.user;
      setAccountEmail(user?.email ?? null);
      if (!user) throw new Error(`No signed-in ${PARTNER.singular} session was found.`);
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
        setLocationError(error instanceof Error ? error.message : 'Could not start location sharing.');
      });
    return () => {
      active = false;
      stopStream?.();
    };
  }, [online, vehicleId]);

  useEffect(() => {
    if (!jobAlert?.pickup) return;
    map.current?.animateToRegion({ ...jobAlert.pickup, latitudeDelta: 0.035, longitudeDelta: 0.035 }, 700);
  }, [jobAlert?.pickup]);

  useEffect(() => {
    if (!online || !vehicleId) return;
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    const receive = (row: Record<string, unknown>) => {
      const alert = mapJob(row);
      if (!active || !alert) return;
      if (alert.status === 'pending') setAcceptedJobCollapsed(false);
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
      .select('id, status, expires_at, breakdown_type, estimated_distance_km, estimated_price_min, service_for, contact_name, contact_phone, vehicle_make_model, vehicle_color, vehicle_registration, passengers, pickup_location')
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
      if (action === 'accept') setAcceptedJobCollapsed(true);
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

  // Sign out locally (this phone only) and send the person back to sign-in.
  // The root layout also redirects on SIGNED_OUT; the explicit replace is a
  // safety net so the screen can never be left blank.
  const switchAccount = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      setMenuOpen(false);
      router.replace('/(auth)/sign-in');
    } catch (error) {
      Alert.alert('Could not switch account', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSwitching(false);
    }
  };

  const statusLine = assignmentLoading
    ? 'Checking your vehicle…'
    : !vehicleId
      ? assignmentError
      : online
        ? 'Sharing your location · waiting for jobs'
        : `Vehicle ${vehicleId.slice(0, 8).toUpperCase()} · ready when you are`;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={lightMapStyle}
        userInterfaceStyle="light"
        showsUserLocation={online}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        initialRegion={JHB}
      >
        {jobAlert?.pickup ? <Marker coordinate={jobAlert.pickup} pinColor={L.route} title="Client pickup" /> : null}
        {jobAlert?.pickup ? <Polyline coordinates={[{ latitude: JHB.latitude, longitude: JHB.longitude }, jobAlert.pickup]} strokeColor={L.route} strokeWidth={4} /> : null}
      </MapView>

      {/* Top bar: status chip + account menu */}
      <View pointerEvents="box-none" style={[styles.topBar, { paddingTop: top + 10 }]}>
        <View style={styles.chip}>
          <View style={[styles.dot, online ? styles.dotOn : styles.dotOff]} />
          <Text style={styles.chipText}>{online ? 'Online' : 'Offline'}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account menu"
          onPress={() => setMenuOpen(true)}
          style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
        >
          <Ionicons name="person-outline" size={20} color={L.text} />
        </Pressable>
      </View>

      {locationError ? (
        <View pointerEvents="none" style={[styles.errorCard, { top: top + 66 }]}>
          <Ionicons name="warning-outline" size={18} color={L.warn} />
          <Text style={styles.errorText}>{locationError}</Text>
        </View>
      ) : null}

      {jobAlert && !offerPending && acceptedJobCollapsed ? (
        <View style={[styles.acceptedPill, { bottom: Math.max(bottom, 12) + 18 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.acceptedPillEyebrow}>ACTIVE JOB</Text>
            <Text style={styles.acceptedPillTitle}>{headline.title}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Show active job details" onPress={() => setAcceptedJobCollapsed(false)} style={styles.showJobButton}>
            <Ionicons name="chevron-up" size={18} color={L.onGo} />
            <Text style={styles.showJobText}>Details</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Bottom control sheet */}
      <View style={[styles.sheet, { paddingBottom: Math.max(bottom, 12) + 14 }]}>
        <View style={styles.grabber} />
        <Text style={styles.eyebrow}>{PARTNER.mode}</Text>
        <Text style={styles.title}>{online ? 'You’re online' : 'You’re offline'}</Text>
        <View style={styles.statusRow}>
          {assignmentLoading ? <ActivityIndicator size="small" color={L.go} /> : online ? <View style={[styles.dot, styles.dotOn]} /> : null}
          <Text style={styles.subtitle}>{statusLine}</Text>
        </View>

        {online ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go offline"
            onPress={() => changeOnline(false)}
            style={({ pressed }) => [styles.offlineButton, pressed && styles.pressed]}
          >
            <Ionicons name="power" size={18} color="#FFFFFF" />
            <Text style={styles.offlineButtonText}>Go offline</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go online"
            disabled={!vehicleId || assignmentLoading}
            onPress={() => changeOnline(true)}
            style={({ pressed }) => [styles.onlineButton, pressed && styles.pressed, (!vehicleId || assignmentLoading) && styles.buttonOff]}
          >
            <Ionicons name="power" size={18} color={L.onGo} />
            <Text style={styles.onlineButtonText}>Go online</Text>
          </Pressable>
        )}

        {!vehicleId && !assignmentLoading ? (
          <Pressable accessibilityRole="button" onPress={() => void loadAssignment()} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
            <Ionicons name="refresh" size={15} color={L.route} />
            <Text style={styles.linkText}>Refresh assignment</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Account menu */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={[styles.menuSheet, { paddingBottom: Math.max(bottom, 12) + 16 }]} onPress={() => undefined}>
            <View style={styles.grabber} />
            <View style={styles.accountRow}>
              <View style={styles.avatar}><Ionicons name="person" size={20} color={L.route} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.accountName}>{PARTNER.Singular} account</Text>
                <Text style={styles.accountEmail} numberOfLines={1}>{accountEmail ?? 'Signed in'}</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch account"
              disabled={switching}
              onPress={() => { void switchAccount(); }}
              style={({ pressed }) => [styles.menuAction, pressed && styles.pressed, switching && styles.buttonOff]}
            >
              {switching ? <ActivityIndicator color={L.text} /> : <Ionicons name="swap-horizontal" size={20} color={L.text} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.menuActionTitle}>Switch account</Text>
                <Text style={styles.menuActionSub}>Sign out and use a different email</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={L.disabledText} />
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setMenuOpen(false)} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Job offer / active job */}
      <Modal visible={!!jobAlert && (offerPending || !acceptedJobCollapsed)} transparent animationType="fade" onRequestClose={() => setAcceptedJobCollapsed(true)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.alertCard}>
            <View style={styles.alertIcon}><Ionicons name={offerPending ? 'notifications' : 'navigate'} size={22} color={L.onGo} /></View>
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
            {!offerPending && jobAlert?.pickup ? (
              <Pressable accessibilityRole="button" onPress={() => { void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${jobAlert.pickup?.latitude},${jobAlert.pickup?.longitude}`); }} style={styles.navigationButton}>
                <Ionicons name="navigate" size={18} color={L.route} />
                <Text style={styles.navigationText}>Open navigation to client</Text>
              </Pressable>
            ) : null}
            {!offerPending ? (
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/(main)/chat/[requestId]', params: { requestId: jobAlert?.id } })} style={styles.chatButton}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={L.text} />
                <Text style={styles.chatText}>Chat with client</Text>
              </Pressable>
            ) : null}
            {offerPending ? (
              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Decline job request"
                  disabled={acting}
                  onPress={() => { void runAction('decline'); }}
                  style={({ pressed }) => [styles.declineButton, pressed && styles.pressed, acting && styles.buttonOff]}
                >
                  <Text style={styles.declineText}>Decline</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Accept job request"
                  disabled={acting || offerSecondsLeft <= 0}
                  onPress={() => { void runAction('accept'); }}
                  style={({ pressed }) => [styles.acceptButton, pressed && styles.pressed, (acting || offerSecondsLeft <= 0) && styles.buttonOff]}
                >
                  {acting ? <ActivityIndicator color={L.onGo} /> : <Text style={styles.acceptText}>Accept job</Text>}
                </Pressable>
              </View>
            ) : nextStep ? (
              <Pressable
                accessibilityRole="button"
                disabled={acting}
                onPress={() => { void runAction(nextStep.action); }}
                style={({ pressed }) => [styles.ackButton, pressed && styles.pressed, acting && styles.buttonOff]}
              >
                {acting ? <ActivityIndicator color={L.onGo} /> : <Text style={styles.ackText}>{nextStep.label}</Text>}
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const shadow = { shadowColor: '#000000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 } as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: L.bg },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  buttonOff: { opacity: 0.5 },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: L.surface, ...shadow },
  chipText: { color: L.text, fontFamily: font.semibold, fontSize: 14 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotOn: { backgroundColor: '#22C55E' },
  dotOff: { backgroundColor: L.disabledText },
  roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: L.surface, ...shadow },
  errorCard: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 16, backgroundColor: L.surface, ...shadow },
  errorText: { flex: 1, color: L.warn, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  acceptedPill: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: L.surface, ...shadow },
  acceptedPillEyebrow: { color: L.go, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.2 },
  acceptedPillTitle: { color: L.text, fontFamily: font.semibold, fontSize: 14, marginTop: 3 },
  showJobButton: { height: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: L.go, flexDirection: 'row', alignItems: 'center', gap: 5 },
  showJobText: { color: L.onGo, fontFamily: font.bold, fontSize: 12 },

  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 10, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: L.surface, gap: 6, shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 16 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: L.disabled, marginBottom: 10 },
  eyebrow: { color: L.go, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.4 },
  title: { color: L.text, fontFamily: font.bold, fontSize: 26, letterSpacing: -0.6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  subtitle: { flex: 1, color: L.textMuted, fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  onlineButton: { height: 56, borderRadius: 999, backgroundColor: L.go, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  onlineButtonText: { color: L.onGo, fontFamily: font.bold, fontSize: 16 },
  offlineButton: { height: 56, borderRadius: 999, backgroundColor: '#111827', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  offlineButtonText: { color: '#FFFFFF', fontFamily: font.bold, fontSize: 16 },
  linkButton: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14 },
  linkText: { color: L.route, fontFamily: font.semibold, fontSize: 13 },

  menuBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.45)' },
  menuSheet: { paddingHorizontal: 20, paddingTop: 10, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: L.surface, gap: 12 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: L.routeSoft, alignItems: 'center', justifyContent: 'center' },
  accountName: { color: L.text, fontFamily: font.bold, fontSize: 16 },
  accountEmail: { color: L.textMuted, fontFamily: font.medium, fontSize: 13, marginTop: 1 },
  menuAction: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingHorizontal: 16, borderRadius: 18, backgroundColor: L.surfaceRaised },
  menuActionTitle: { color: L.text, fontFamily: font.semibold, fontSize: 15 },
  menuActionSub: { color: L.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 1 },
  closeButton: { height: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: L.border },
  closeText: { color: L.text, fontFamily: font.semibold, fontSize: 15 },

  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(17,24,39,0.55)' },
  alertCard: { width: '100%', padding: 22, borderRadius: 28, backgroundColor: L.surface, gap: 10 },
  alertIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: L.go, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  alertEyebrow: { color: L.go, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.4 },
  alertTitle: { color: L.text, fontFamily: font.bold, fontSize: 22, letterSpacing: -0.4, marginBottom: 4 },
  jobRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: L.border },
  jobLabel: { color: L.textMuted, fontFamily: font.medium, fontSize: 13 },
  jobValue: { flexShrink: 1, color: L.text, fontFamily: font.semibold, fontSize: 14, textAlign: 'right' },
  jobRef: { color: L.textMuted, fontFamily: font.medium, fontSize: 11, marginTop: 3 },
  offerTimer: { color: L.warn, fontFamily: font.semibold, fontSize: 12 },
  actionError: { color: L.danger, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  acceptButton: { flex: 1.4, height: 54, borderRadius: 999, backgroundColor: L.go, alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: L.onGo, fontFamily: font.bold, fontSize: 15 },
  declineButton: { flex: 1, height: 54, borderRadius: 999, borderWidth: 1, borderColor: L.border, backgroundColor: L.surface, alignItems: 'center', justifyContent: 'center' },
  declineText: { color: L.text, fontFamily: font.semibold, fontSize: 15 },
  ackButton: { height: 54, borderRadius: 999, backgroundColor: L.go, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ackText: { color: L.onGo, fontFamily: font.bold, fontSize: 15 },
  navigationButton: { height: 46, borderRadius: 14, backgroundColor: L.routeSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 2 },
  navigationText: { color: L.route, fontFamily: font.bold, fontSize: 13 },
  chatButton: { height: 46, borderRadius: 14, borderWidth: 1, borderColor: L.border, backgroundColor: L.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  chatText: { color: L.text, fontFamily: font.semibold, fontSize: 13 },
});
