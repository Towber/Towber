import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { VehicleType } from '../api';

const icons: Record<VehicleType, keyof typeof MaterialCommunityIcons.glyphMap> = {
  flatbed_rollback: 'truck-flatbed',
  standard_tow: 'tow-truck',
  heavy_duty: 'truck-cargo-container',
  winch_recovery: 'hook',
  roadside_unit: 'car-wrench',
};
export const typeLabel: Record<VehicleType, string> = {
  flatbed_rollback: 'Flatbed / Rollback', standard_tow: 'Light Tow', heavy_duty: 'Heavy Duty', winch_recovery: 'Winch Bakkie / Sling Tow', roadside_unit: 'Roadside Unit',
};

export const TruckIcon = ({ type, size = 24, color }: { type: VehicleType; size?: number; color: string }) => (
  <MaterialCommunityIcons name={icons[type] ?? 'tow-truck'} size={size} color={color} />
);
