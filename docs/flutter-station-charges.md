# Railway station entry fee and location charges – Flutter implementation guide

Railway stations (and airports) can now charge a rider:

| Charge | Set in admin | When it is added to the fare | Who keeps it |
|---|---|---|---|
| **Airport fee** | Price Management → Airport (type *Airport*) | At booking | Platform fare (commission applies) |
| **Station entry fee** (new) | Price Management → Airport (type *Railway Station*) → *Station Entry Fee* | At booking | Driver, no commission |
| **Pickup parking** | Same page, parking rules (timed slabs) | When the trip completes, from how long the driver waited inside the station or airport | Driver, no commission |
| **Drop-off fee** | Same page, parking rules | When the trip completes | Driver, no commission |

The web rider and driver apps already show all of this. This guide covers what
the Flutter **rider** and **driver** apps need.

Base URL: `https://kranticabs.com/api/v1`.

**Important:** the server adds the station entry fee to the fare whether or not the
app shows it. Until the rider app shows it in the estimate, riders at stations
will see a higher final fare than the app quoted. Ship the rider part (section 2) first.

Nothing in the booking request changes. Keep sending the **trip fare alone** as
`fare`. Never add the airport fee, station fee or parking to it, or the rider will
be charged twice.

---

## 1. Where the data comes from

| Data | Where |
|---|---|
| Estimate before booking | `GET /users/trip-category?pickup=lat,lng&drop=lat,lng&vehicle_class=car` → `data.station_fee` (new), `data.airport`, `data.hub_parking` |
| Charges on a booked ride | Every ride payload → `locationCharges` (new) and `hubParking`. This includes `ride:state` socket events, `GET /rides/:rideId`, `GET /rides/active/me`, and the `PATCH /rides/:rideId/status` response |

`vehicle_class` is `bike`, `auto` or `car`. Leave it out and `hub_parking` comes back
per class under `by_vehicle_class`. `station_fee` is the same for every class.

---

## 2. Rider app – fare estimate (vehicle list)

`GET /users/trip-category` now also returns `station_fee`. It is `null` when neither
end is at a station with a fee:

```json
{
  "success": true,
  "data": {
    "category": "city",
    "airport": null,
    "hubs": {
      "pickup": { "id": "66f…", "name": "KSR Bengaluru", "hub_type": "railway_station" },
      "drop": null
    },
    "station_fee": {
      "lines": [ { "hub_id": "66f…", "name": "KSR Bengaluru", "end": "pickup", "fee": 20 } ],
      "total_fee": 20
    },
    "hub_parking": {
      "by_vehicle_class": {
        "car": {
          "pickup": { "name": "KSR Bengaluru", "fee_from": 30, "varies_with_wait": true, "slabs": [ … ] },
          "drop": null,
          "estimated_total": 30
        }
      }
    }
  }
}
```

**Displayed fare per vehicle** = vehicle trip fare + `airport.total_fee` + `station_fee.total_fee`.
Parking is not included because it depends on the wait.

Under the selected vehicle, show a **Location charges** box when any of these are above 0:

| Line | Value |
|---|---|
| `<airport name> fee` | `airport.total_fee` |
| `<station names joined by " & "> entry` | `station_fee.total_fee` |
| `Parking (from)` (drop "(from)" when `varies_with_wait` is false) | `hub_parking…estimated_total` |

Footnotes to show:
- Airport or station fee: "The … fee is included in the estimated fare."
- Parking: "Parking is added at the end of the trip from how long the driver waits at the hub."

Rules the server follows, for reference:
- Each station end pays its fee once. A trip that starts and ends at the same station pays it once.
- A pickup at station A and a drop at station B pays both fees.
- Airports never charge the station fee. They use the airport fee instead.

---

## 3. Both apps – charges on a booked ride

Every ride payload now has `locationCharges`, a list ready to print. It is empty
for an ordinary trip:

```json
"locationCharges": [
  { "code": "station_entry",  "label": "Station entry - KSR Bengaluru",   "amount": 20 },
  { "code": "pickup_parking", "label": "Parking - KSR Bengaluru (12 min)", "amount": 40 }
]
```

| `code` | Meaning | Present from |
|---|---|---|
| `airport_fee` | Airport fee | Booking |
| `station_entry` | Station entry fee, one line per station | Booking |
| `pickup_parking` | Timed pickup parking | Trip completion |
| `drop_fee` | Flat drop-off fee | Trip completion |

All of these are **already inside `fare`**. Show them as a breakdown and never add
them to `fare` again.

Parking lines only appear once the trip completes. Before that, use `hubParking`
(it already existed) for a live estimate:

```json
"hubParking": {
  "pickup": {
    "name": "KSR Bengaluru", "hub_type": "railway_station",
    "slabs": [ { "up_to_minutes": 10, "fee": 30 }, { "up_to_minutes": 30, "fee": 60 } ],
    "entered_at": "2026-10-22T09:01:12.000Z", "exited_at": null, "minutes": 0, "fee": 0
  },
  "drop": null,
  "total_fee": 0,
  "applied_at": null
}
```

While `applied_at` is `null`:
- **Minutes so far** = ceil((`exited_at` ?? now) − `entered_at`) in minutes. Part-minutes count as a full minute, as on the server.
- **Estimated pickup parking** = the fee of the first slab with `up_to_minutes ≥ minutes`. If the stay is longer than every slab, use the last slab.
- **Drop-off fee** = `drop.drop_fee`.
- If `entered_at` is `null`, the driver hasn't entered the station area yet. Show the first slab's fee as "from".

Once `applied_at` is set, stop the timer and show only the `locationCharges` lines.

### Rider app
Above the total fare on the live tracking screen and the trip summary, list every
`locationCharges` line. While the trip runs, also show the live parking estimate
("Parking - KSR Bengaluru (12 min so far) ~Rs 60").

### Driver app
- **Waiting for the OTP at pickup:** show the parking timer and estimate so the driver
  knows what the barrier will charge. Refresh it every 15–30 seconds. The server
  times the stay from the driver's live location, so keep sending location
  updates while waiting.
- **Ride summary / earnings:** list the `locationCharges` lines as "Included in fare".
- **Commission preview:** if the app works out commission itself before settlement,
  leave out the pass-through charges:

```dart
const passThroughCodes = {'station_entry', 'pickup_parking', 'drop_fee'};

double commissionPreview(Ride ride) {
  final passThrough = ride.locationCharges
      .where((c) => passThroughCodes.contains(c.code))
      .fold<double>(0, (sum, c) => sum + c.amount);
  final base = (ride.fare - passThrough).clamp(0, double.infinity);
  final snap = ride.pricingSnapshot;
  return snap.adminCommissionTypeFromDriver == 1      // 1 = percent
      ? (base * snap.adminCommissionFromDriver / 100)
      : snap.adminCommissionFromDriver.clamp(0, base).toDouble();
}
```

Once the ride is settled, `commissionAmount` and `driverEarnings` in the payload are
the real figures, so prefer those.

---

## 4. Suggested Dart models

```dart
class LocationCharge {
  final String code, label;
  final double amount;
  LocationCharge.fromJson(Map<String, dynamic> j)
      : code = j['code'] as String? ?? '',
        label = j['label'] as String? ?? '',
        amount = (j['amount'] as num?)?.toDouble() ?? 0;
}

class StationFee {
  final double totalFee;
  final List<String> names;
  StationFee.fromJson(Map<String, dynamic> j)
      : totalFee = (j['total_fee'] as num?)?.toDouble() ?? 0,
        names = ((j['lines'] as List?) ?? const [])
            .map((l) => (l['name'] as String?) ?? '')
            .where((n) => n.isNotEmpty)
            .toList();
}

// On the Ride model:
//   locationCharges = ((json['locationCharges'] as List?) ?? const [])
//       .map((e) => LocationCharge.fromJson(e)).toList();
// On the trip-category model:
//   stationFee = json['station_fee'] == null ? null : StationFee.fromJson(json['station_fee']);

int parkingMinutesSoFar(DateTime enteredAt, DateTime? exitedAt) {
  final end = exitedAt ?? DateTime.now();
  return (end.difference(enteredAt).inSeconds / 60).ceil().clamp(0, 1 << 30);
}

double slabFee(List<Map<String, dynamic>> slabs, int minutes) {
  if (slabs.isEmpty) return 0;
  final sorted = [...slabs]..sort((a, b) =>
      (a['up_to_minutes'] as num).compareTo(b['up_to_minutes'] as num));
  final slab = sorted.firstWhere(
      (s) => minutes <= (s['up_to_minutes'] as num), orElse: () => sorted.last);
  return (slab['fee'] as num).toDouble();
}
```

Treat both new fields as optional (`?? []` / `null`). An older backend, or a ride
booked before this release, simply won't have them.

---

## 5. Test checklist

Set up in admin first: one railway station with a drawn boundary, a **Station Entry
Fee** of Rs 20, and parking switched on with slabs (for example, up to 10 min Rs 30,
up to 30 min Rs 60).

- [ ] Pickup inside the station: the vehicle list price is trip fare + 20, and the Location charges box shows "… entry Rs 20" and "Parking (from) Rs 30"
- [ ] Booking sends `fare` **without** the 20. The booked ride's `fare` includes it, and `locationCharges` has a `station_entry` line
- [ ] Driver waiting at the pickup sees the parking timer climb and the estimate move from Rs 30 to Rs 60 after 10 minutes
- [ ] After completion, `locationCharges` adds `pickup_parking` and the timer is gone
- [ ] Driver earnings: no commission on the Rs 20 or on the parking (compare with Admin → Trips → Trip Details)
- [ ] An ordinary city trip shows no Location charges anywhere
- [ ] Pickup at station A and drop at station B shows both entry fees
- [ ] An airport trip still shows the airport fee and never a station fee
