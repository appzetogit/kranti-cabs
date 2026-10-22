import { Airport } from '../admin/models/Airport.js';
import { TaxiAppModule } from '../admin/models/TaxiAppModule.js';
import { findZoneByPickup } from './matchingService.js';
import { estimateHubParking, hubAt, hubTypeOf } from './hubParkingService.js';

/**
 * What kind of trip a pickup and drop make, which decides the vehicles a rider
 * is offered:
 *
 *   - airport     the pickup is inside an airport the admin has drawn (and that
 *                 airport takes pickups), or the drop is (and it takes drops)
 *   - outstation  the drop is outside every zone, or in another city's zone -
 *                 Bengaluru to Mysuru is outstation though both are zones
 *   - city        pickup and drop in the same city
 *   - unserviceable  the pickup is outside every zone
 *
 * Checked in that order, so a trip to the airport from the city is an airport
 * trip, not a city one. Kept on the server so editing an airport boundary or a
 * zone in the admin panel takes effect without an app release.
 *
 * Railway stations live in the same collection as airports (hub_type) but do
 * not change the category - a station trip is still a city or outstation one.
 * Either kind of hub can charge parking, returned here as an estimate.
 */

const CACHE_MS = 60 * 1000;

let hubCache = { rows: null, at: 0 };
let moduleCache = { rows: null, at: 0 };

/// Every active hub - airports and railway stations.
const activeHubs = async () => {
  if (hubCache.rows && Date.now() - hubCache.at < CACHE_MS) return hubCache.rows;
  const rows = await Airport.find({ active: true, status: 'active' })
    .select('hub_type parking name code location boundary latitude longitude pickup_availability drop_availability airport_surge support_airport_fee station_entry_fee')
    .lean();
  hubCache = { rows, at: Date.now() };
  return rows;
};

/// The hubs a pickup and drop sit in, whatever their type.
export const resolveTripHubs = async ({ pickup, drop }) => {
  const hubs = await activeHubs();
  return { pickupHub: hubAt(hubs, pickup), dropHub: hubAt(hubs, drop) };
};

const activeModules = async () => {
  if (moduleCache.rows && Date.now() - moduleCache.at < CACHE_MS) return moduleCache.rows;
  const rows = await TaxiAppModule.find({}).select('name service_type transport_type active').lean();
  moduleCache = { rows: rows.filter((row) => Number(row.active) === 1 || row.active === true), at: Date.now() };
  return moduleCache.rows;
};

/// The app module whose vehicles a trip category offers.
const moduleFor = (modules, category) => {
  const taxi = modules.filter((row) => (row.transport_type || 'taxi') === 'taxi');
  if (category === 'outstation') return taxi.find((row) => row.service_type === 'outstation') || null;
  if (category === 'airport') return taxi.find((row) => /airport/i.test(row.name)) || null;
  return (
    taxi.find((row) => row.service_type === 'normal' && /city/i.test(row.name))
    || taxi.find((row) => row.service_type === 'normal' && !/airport/i.test(row.name))
    || null
  );
};

const serviceLocationOf = (zone) => {
  const id = zone?.service_location_id?._id || zone?.service_location_id;
  return id ? String(id) : null;
};

const hubBrief = (row) => (row ? { id: String(row._id), name: row.name, hub_type: hubTypeOf(row) } : null);

/**
 * The railway station entry fee a trip pays: each station end with a fee pays
 * it once, and a trip that starts and ends at the same station pays it once.
 * Unlike parking it does not depend on the wait, so it is known at booking.
 */
export const stationEntryFees = (pickupHub, dropHub) => {
  const ends = [['pickup', pickupHub], ['drop', dropHub]]
    .filter(([, row]) => row && hubTypeOf(row) === 'railway_station' && Number(row.station_entry_fee) > 0);
  const seen = new Set();
  const lines = [];
  ends.forEach(([end, row]) => {
    if (seen.has(String(row._id))) return;
    seen.add(String(row._id));
    lines.push({
      hub_id: String(row._id),
      name: row.name,
      end,
      fee: Math.round(Number(row.station_entry_fee) * 100) / 100,
    });
  });
  if (!lines.length) return null;
  return {
    lines,
    total_fee: Math.round(lines.reduce((sum, line) => sum + line.fee, 0) * 100) / 100,
  };
};

/// Parking estimate for each vehicle class, so a vehicle list can show each.
const parkingByClass = (pickupHub, dropHub) => {
  if (!pickupHub?.parking?.enabled && !dropHub?.parking?.enabled) return null;
  return {
    by_vehicle_class: Object.fromEntries(
      ['bike', 'auto', 'car'].map((vehicleClass) => [
        vehicleClass,
        estimateHubParking({ pickupHub, dropHub, vehicleClass }),
      ]),
    ),
  };
};

/**
 * @param pickup [lng, lat]
 * @param drop   [lng, lat]
 * @param vehicleClass optional bike / auto / car, to narrow the parking estimate
 */
export const classifyTrip = async ({ pickup, drop, vehicleClass = '' }) => {
  const [pickupZone, dropZone, hubs, modules] = await Promise.all([
    findZoneByPickup(pickup).catch(() => null),
    findZoneByPickup(drop).catch(() => null),
    activeHubs(),
    activeModules(),
  ]);

  if (!pickupZone) {
    return {
      category: 'unserviceable',
      message: "We don't serve this pickup point yet.",
      module_id: null,
      module_name: null,
      airport: null,
      hubs: { pickup: null, drop: null },
      station_fee: null,
      hub_parking: null,
    };
  }

  const airports = hubs.filter((row) => hubTypeOf(row) === 'airport');
  const pickupAirport = hubAt(airports, pickup);
  const dropAirport = hubAt(airports, drop);
  const airport =
    (pickupAirport && pickupAirport.pickup_availability !== false ? { row: pickupAirport, end: 'pickup' } : null)
    || (dropAirport && dropAirport.drop_availability !== false ? { row: dropAirport, end: 'drop' } : null);
  const pickupHub = hubAt(hubs, pickup);
  const dropHub = hubAt(hubs, drop);

  let category = 'city';
  if (airport) {
    category = 'airport';
  } else if (!dropZone || serviceLocationOf(dropZone) !== serviceLocationOf(pickupZone)) {
    category = 'outstation';
  }

  const module = moduleFor(modules, category);
  const airportSurgeFee = Math.max(0, Number(airport?.row.airport_surge) || 0);
  const airportSupportFee = Math.max(0, Number(airport?.row.support_airport_fee) || 0);

  return {
    category,
    module_id: module ? String(module._id) : null,
    module_name: module?.name || null,
    pickup_zone: { id: String(pickupZone._id), name: pickupZone.name || '' },
    drop_zone: dropZone ? { id: String(dropZone._id), name: dropZone.name || '' } : null,
    airport: airport
      ? {
          id: String(airport.row._id),
          name: airport.row.name,
          code: airport.row.code || '',
          end: airport.end,
          // Flat charges the admin set on the airport ("airport surge fee" and
          // "support airport fee"), added once to an airport trip's fare.
          surge_fee: airportSurgeFee,
          support_fee: airportSupportFee,
          total_fee: airportSurgeFee + airportSupportFee,
        }
      : null,
    // Any hub at either end - airport or railway station.
    hubs: { pickup: hubBrief(pickupHub), drop: hubBrief(dropHub) },
    // Railway station entry fee, added to the fare by the server at booking
    // like the airport fee - the app shows it but never sends it.
    station_fee: stationEntryFees(pickupHub, dropHub),
    // Parking the hubs charge, added to the fare by the server when the trip
    // completes - the pickup part by how long the driver waited inside.
    hub_parking: vehicleClass
      ? estimateHubParking({ pickupHub, dropHub, vehicleClass })
      : parkingByClass(pickupHub, dropHub),
  };
};
