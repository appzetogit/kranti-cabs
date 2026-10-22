# State tax and MCD tax – Flutter implementation guide

A trip can now carry a **state tax** (a commercial vehicle's entry / permit tax for
another state) and an **MCD tax** (Delhi's entry tax). Both work like the railway
station entry fee in [flutter-station-charges.md](flutter-station-charges.md):

| | |
|---|---|
| Set in admin | Price Management → **State & MCD Tax**: one rule per state and type, with an amount for bike, auto and car (0 = not charged) |
| When a trip pays it | Its **drop** is in the rule's state and its **pickup is not**. Indore → Jaipur pays Rajasthan's; Jaipur → Jaipur pays nothing; Noida → Delhi pays Delhi's MCD tax and Delhi's state tax if both are set. A state the route only passes through is not charged |
| When it is added | At booking, by the server |
| Who keeps it | The driver (paid at the border), no commission |

Base URL: `https://kranticabs.com/api/v1`.

**Nothing in the booking request changes.** Keep sending the **trip fare alone**
as `fare`. Never add the tax to it, or the rider is charged twice.

The server works out each end's state with Google's reverse geocoder. If that
lookup fails, the trip is quoted and booked **without** the tax. The app has
nothing to handle for that case.

---

## 1. Rider app – fare estimate (vehicle list)

`GET /users/trip-category?pickup=lat,lng&drop=lat,lng` now also returns `tax_fee`.
It is `null` when no tax applies to the trip.

Without `vehicle_class` (the usual call from the vehicle list) it comes per class:

```json
"tax_fee": {
  "by_vehicle_class": {
    "bike": null,
    "auto": {
      "lines": [
        { "rule_id": "6ada…", "name": "Rajasthan state tax", "tax_type": "state_tax", "state": "Rajasthan", "fee": 100 }
      ],
      "total_fee": 100
    },
    "car": {
      "lines": [
        { "rule_id": "6ada…", "name": "Rajasthan state tax", "tax_type": "state_tax", "state": "Rajasthan", "fee": 300 }
      ],
      "total_fee": 300
    }
  }
}
```

With `vehicle_class=car` it is that class's `{ "lines": [...], "total_fee": 300 }` (or `null`).

A class whose entry is `null` pays no tax on this trip. Pick the class the same
way you already pick it for `hub_parking.by_vehicle_class`: the vehicle's
`category` if it is `bike`, `auto` or `car`, else `car`. The server uses the same
rule at booking.

**Displayed fare per vehicle** = vehicle trip fare + `airport.total_fee` +
`station_fee.total_fee` + `tax_fee.by_vehicle_class[class].total_fee`.

In the **Location charges** box under the selected vehicle, add one line per tax line:

| `tax_type` | Label |
|---|---|
| `state_tax` | `State tax - <state>` |
| `mcd_tax` | `MCD tax - <state>` |

Footnote: "State / MCD tax for entering the drop state is included in the estimated fare."

---

## 2. Both apps – charges on a booked ride

The tax arrives in the existing `locationCharges` list on every ride payload
(`ride:state` socket events, `GET /rides/:rideId`, `GET /rides/active/me`, the
`PATCH /rides/:rideId/status` response). If you already print `locationCharges`,
the tax lines appear with no extra work:

```json
"locationCharges": [
  { "code": "mcd_tax",   "label": "MCD tax - Delhi",   "amount": 125 },
  { "code": "state_tax", "label": "State tax - Delhi", "amount": 200 }
]
```

| `code` | Meaning | Present from |
|---|---|---|
| `state_tax` | State entry / permit tax, one line per rule | Booking |
| `mcd_tax` | Delhi MCD tax | Booking |

Like every location charge these are **already inside `fare`**. Show them as a
breakdown, never add them again.

### Driver app – commission preview
If the app works out commission itself before settlement, add the two codes to
the pass-through set from the station charges guide:

```dart
const passThroughCodes = {
  'station_entry', 'pickup_parking', 'drop_fee',
  'state_tax', 'mcd_tax', // new
};
```

After settlement, `commissionAmount` and `driverEarnings` in the payload are the
real figures. Prefer those.

---

## 3. Suggested Dart model

```dart
class TaxLine {
  final String name, taxType, state;
  final double fee;
  TaxLine.fromJson(Map<String, dynamic> j)
      : name = j['name'] as String? ?? '',
        taxType = j['tax_type'] as String? ?? 'state_tax',
        state = j['state'] as String? ?? '',
        fee = (j['fee'] as num?)?.toDouble() ?? 0;

  String get label => '${taxType == 'mcd_tax' ? 'MCD tax' : 'State tax'} - $state';
}

class TaxFee {
  final List<TaxLine> lines;
  final double totalFee;
  TaxFee.fromJson(Map<String, dynamic> j)
      : lines = ((j['lines'] as List?) ?? const [])
            .map((e) => TaxLine.fromJson(e as Map<String, dynamic>))
            .toList(),
        totalFee = (j['total_fee'] as num?)?.toDouble() ?? 0;
}

/// tax_fee for one vehicle class from a trip-category response, or null.
TaxFee? taxFeeFor(Map<String, dynamic>? taxFee, String vehicleClass) {
  final byClass = taxFee?['by_vehicle_class'] as Map<String, dynamic>?;
  final entry = byClass != null ? byClass[vehicleClass] : taxFee;
  return entry == null ? null : TaxFee.fromJson(entry as Map<String, dynamic>);
}
```

Treat `tax_fee` as optional. An older backend, or a ride booked before this
release, won't have it.

---

## 4. Test checklist

Set up in admin first: **Rajasthan state tax**, state `Rajasthan`, auto ₹100, car ₹300, bike 0.

- [ ] Indore → Jaipur: the car shows trip fare + 300, the auto + 100, the bike no tax line
- [ ] Booking sends `fare` **without** the 300. The booked ride's `fare` includes it and `locationCharges` has a `state_tax` line
- [ ] Jaipur → Jaipur and Indore → Indore show no tax
- [ ] Jaipur → Indore shows no tax (no Madhya Pradesh rule)
- [ ] Switch the rule off in admin: within a minute Indore → Jaipur shows no tax
- [ ] Driver earnings on a completed Indore → Jaipur trip: no commission on the 300 (compare with Admin → Trips → Trip Details)
- [ ] With a Delhi MCD rule (state `Delhi`, type MCD): Noida → Delhi shows an `MCD tax - Delhi` line
