import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { VehicleType } from '../api';

const icons: Record<VehicleType, keyof typeof MaterialCommunityIcons.glyphMap> = {
  flatbed_rollback: 'truck-flatbed',
  standard_tow: 'tow-truck',
  heavy_duty: 'truck-cargo-container',
  winch_recovery: 'hook',
};
export const typeLabel: Record<VehicleType, string> = {
  flatbed_rollback: 'Flatbed', standard_tow: 'Light Tow', heavy_duty: 'Heavy Duty', winch_recovery: 'Winch Recovery',
};

export const TruckIcon = ({ type, size = 24, color }: { type: VehicleType; size?: number; color: string }) => (
  <MaterialCommunityIcons name={icons[type] ?? 'tow-truck'} size={size} color={color} />
);
