import type { BreakdownType, RequestDetails, VehicleType } from './api';

// In-memory hand-off from the service screen to the map screen.
// Towing type filter for Towing & recovery. 'any' shows every tow vehicle.
export type TowTypeFilter = 'any' | 'flatbed' | 'winch';
export type RequestDraft = { breakdownType: BreakdownType; towType?: TowTypeFilter } & RequestDetails;

export const TOW_TYPE_OPTIONS: { id: TowTypeFilter; label: string; icon: string }[] = [
  { id: 'any', label: 'Any', icon: 'tow-truck' },
  { id: 'flatbed', label: 'Flatbed / Rollback', icon: 'truck-flatbed' },
  { id: 'winch', label: 'Winch Bakkie / Sling Tow', icon: 'hook' },
];

const TOW_TYPE_VEHICLES: Record<TowTypeFilter, VehicleType[] | null> = {
  any: null,
  flatbed: ['flatbed_rollback'],
  winch: ['winch_recovery'],
};
export const matchesTowType = (vehicleType: VehicleType, filter: TowTypeFilter) => {
  const allowed = TOW_TYPE_VEHICLES[filter];
  return !allowed || allowed.includes(vehicleType);
};

export const SERVICES: {
  id: BreakdownType;
  label: string;
  blurb: string;
  icon: string; // MaterialCommunityIcons glyph
}[] = [
  { id: 'flatbed', label: 'Towing & recovery', blurb: 'Flatbed, winch bakkie or sling tow to your destination', icon: 'tow-truck' },
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
