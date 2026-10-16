/**
 * Turns a coordinate into a stable zone, and a zone back into a polygon.
 *
 * Deliberately dependency-free. H3 would give real hexagons, but it is a new
 * package on a production box for something a deterministic grid does just as
 * well at this zoom — and every piece of grid maths the rest of the feature
 * needs is confined to this file, so swapping in H3 later means rewriting
 * `zoneIdFor` / `zoneGeometry` and nothing else.
 *
 * Cells are sized in metres and converted to degrees per row, so a cell stays
 * roughly square on the ground instead of stretching as latitude increases.
 */

const EARTH_RADIUS_M = 6371000;
const METRES_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_M) / 180;

const toRadians = (deg) => (deg * Math.PI) / 180;

/// Metres per degree of longitude shrinks toward the poles. Clamped near the
/// poles so the maths cannot divide by ~0.
const metresPerDegLng = (latDeg) => {
  const scale = Math.cos(toRadians(latDeg));
  return METRES_PER_DEG_LAT * Math.max(0.01, scale);
};

/// Height of one cell in degrees of latitude. Constant everywhere.
export const cellHeightDeg = (resolutionMeters) => resolutionMeters / METRES_PER_DEG_LAT;

/// Width of one cell in degrees of longitude, for the row a given latitude is
/// in. Wider in degrees near the poles so it stays the same width in metres.
export const cellWidthDeg = (resolutionMeters, latDeg) =>
  resolutionMeters / metresPerDegLng(latDeg);

/// Row index for a latitude. Rows are the stable part of the scheme: a cell's
/// longitude width depends on its row, so the row has to be resolved first.
const rowFor = (lat, heightDeg) => Math.floor((lat + 90) / heightDeg);

/// The latitude at the centre of a row, which is what sizes that row's cells.
const rowCenterLat = (row, heightDeg) => (row + 0.5) * heightDeg - 90;

const colFor = (lng, widthDeg) => Math.floor((lng + 180) / widthDeg);

/**
 * Stable id for the cell containing a coordinate.
 *
 * Encodes the resolution so zones from different resolutions can never be
 * confused for one another in a cache or a socket payload.
 */
export const zoneIdFor = (lat, lng, resolutionMeters) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const heightDeg = cellHeightDeg(resolutionMeters);
  const row = rowFor(lat, heightDeg);
  const widthDeg = cellWidthDeg(resolutionMeters, rowCenterLat(row, heightDeg));
  const col = colFor(lng, widthDeg);

  return `${Math.round(resolutionMeters)}:${row}:${col}`;
};

/// Centre point and corner ring for a zone id, ready to draw.
export const zoneGeometry = (zoneId) => {
  const [resRaw, rowRaw, colRaw] = String(zoneId || '').split(':');
  const resolutionMeters = Number(resRaw);
  const row = Number(rowRaw);
  const col = Number(colRaw);

  if (![resolutionMeters, row, col].every(Number.isFinite)) return null;

  const heightDeg = cellHeightDeg(resolutionMeters);
  const south = row * heightDeg - 90;
  const north = south + heightDeg;

  const widthDeg = cellWidthDeg(resolutionMeters, rowCenterLat(row, heightDeg));
  const west = col * widthDeg - 180;
  const east = west + widthDeg;

  return {
    center: {
      lat: Number(((south + north) / 2).toFixed(6)),
      lng: Number(((west + east) / 2).toFixed(6)),
    },
    // Closed ring, corners in order. Google Maps closes it itself, but sending
    // an explicit ring keeps the payload unambiguous for any other consumer.
    polygon: [
      { lat: Number(south.toFixed(6)), lng: Number(west.toFixed(6)) },
      { lat: Number(north.toFixed(6)), lng: Number(west.toFixed(6)) },
      { lat: Number(north.toFixed(6)), lng: Number(east.toFixed(6)) },
      { lat: Number(south.toFixed(6)), lng: Number(east.toFixed(6)) },
    ],
  };
};

/// Great-circle distance in metres, used to trim zones to a real radius rather
/// than the square bounding box the database query uses.
export const distanceMeters = (fromLat, fromLng, toLat, toLng) => {
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
