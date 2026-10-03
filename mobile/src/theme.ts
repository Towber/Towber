export const colors = {
  bg: '#090D16',
  surface: '#0F172A',
  surfaceRaised: '#1E293B',
  border: 'rgba(148,163,184,0.18)',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  go: '#00E676',      // primary actions
  route: '#38BDF8',   // route line, selection
  warn: '#FBBF24',
  danger: '#F43F5E',
};

export const radius = { sheet: 24, card: 20, pill: 999 };

// Plus Jakarta Sans via @expo-google-fonts/plus-jakarta-sans
export const font = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
};

export const zar = (n: number) => `R ${Math.round(n).toLocaleString('en-ZA').replace(/\u00a0/g, ' ')}`;
export const zarRange = (a: number, b: number) => Math.round(a) === Math.round(b) ? zar(a) : `${zar(a)} – ${zar(b)}`;

export const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0F172A' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#64748B' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0F172A' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1E293B' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#334155' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#090D16' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

// Light, Bolt-style palette for the rider (client) screen: white surfaces, green actions.
export const light = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceRaised: '#F3F4F6',
  border: 'rgba(17,24,39,0.10)',
  text: '#111827',
  textMuted: '#6B7280',
  go: '#2B8656',               // primary green buttons
  goSoft: 'rgba(43,134,86,0.10)',
  onGo: '#FFFFFF',
  route: '#14452F',            // route line, pins, icons (dark green like Bolt)
  routeSoft: 'rgba(20,69,47,0.08)',
  warn: '#B45309',
  danger: '#DC2626',
  disabled: '#E5E7EB',
  disabledText: '#9CA3AF',
  header: '#000000',           // Uber-style top bar
  onHeader: '#FFFFFF',
};

// Clean, low-contrast light map for the partner screen: soft grey land,
// white roads, pale blue water, and no POI/transit clutter behind the controls.
export const lightMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#F3F4F6' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6B7280' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#EEF1F0' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E5E7EB' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#9CA3AF' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#FDE9B8' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#F5D68A' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D6E6F2' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#7C93A6' }] },
];
