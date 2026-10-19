export interface Coordinates {
  latitude: number;
  longitude: number;
}

const earthRadiusKm = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// Great-circle distance in kilometers (Haversine formula).
export const distanceKm = (from: Coordinates, to: Coordinates): number => {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
};

export const hasCoordinates = (value: { latitude: number | null; longitude: number | null }): value is Coordinates =>
  value.latitude !== null && value.longitude !== null && Number.isFinite(value.latitude) && Number.isFinite(value.longitude);

// Rough bounding box of Colombia, used to catch swapped or mistyped coordinates.
export const colombiaBounds = { minLatitude: -4.3, maxLatitude: 13.6, minLongitude: -82, maxLongitude: -66.8 };

export const isInColombia = ({ latitude, longitude }: Coordinates) =>
  latitude >= colombiaBounds.minLatitude && latitude <= colombiaBounds.maxLatitude && longitude >= colombiaBounds.minLongitude && longitude <= colombiaBounds.maxLongitude;

// Meters in steps of 50 under 1 km; anything that rounds to 1000 m or more is shown in km.
export const formatDistance = (km: number) => {
  const meters = Math.max(50, Math.round((km * 1000) / 50) * 50);
  return meters < 1000 ? `${meters} m` : `${Math.max(1, km).toFixed(1).replace('.', ',')} km`;
};
