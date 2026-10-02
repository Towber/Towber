import type { BreakdownType, RequestDetails } from './api';

// In-memory hand-off from the service screen to the map screen.
export type RequestDraft = { breakdownType: BreakdownType } & RequestDetails;

export const SERVICES: {
  id: BreakdownType;
  label: string;
  blurb: string;
  icon: string; // MaterialCommunityIcons glyph
}[] = [
  { id: 'flatbed', label: 'Towing & recovery', blurb: 'Flatbed or standard tow to your destination', icon: 'tow-truck' },
  { id: 'jumpstart', label: 'Jump start', blurb: 'Back on the road in minutes', icon: 'flash-outline' },
  { id: 'fuel', label: 'Fuel delivery', blurb: 'Enough to reach the nearest station', icon: 'gas-station-outline' },
  { id: 'tyre', label: 'Tyre change', blurb: 'Spare fitted on the spot', icon: 'tire' },
  { id: 'lockout', label: 'Lockout', blurb: 'Locked out of your car', icon: 'key-outline' },
  { id: 'repair', label: 'Minor repairs', blurb: 'Small on-site fixes where possible', icon: 'wrench-outline' },
];

export const serviceLabel = (id: BreakdownType) => SERVICES.find((s) => s.id === id)?.label ?? 'Towing & recovery';
export const serviceIcon = (id: BreakdownType) => SERVICES.find((s) => s.id === id)?.icon ?? 'tow-truck';

let draft: RequestDraft | null = null;
export const getDraft = () => draft;
export const setDraft = (d: RequestDraft | null) => { draft = d; };
