# Hourly Rental – Flutter implementation guide

Hourly cab rentals ("1 Hour / 10 KM" … "12 Hours / 120 KM") are live on the
backend and the web app. This guide covers what the Flutter **rider** and
**driver** apps need to support them. All prices come from the server; the apps
never calculate a fare.

Base URL: `https://kranticabs.com/api/v1`. Socket: `https://kranticabs.com`.

---

## 0. Do this first: check the current driver app

Rental rides are already being dispatched with `type` / `serviceType` =
`"hourly_rental"`. If the driver app's `RideRequest.fromJson` (or any enum
mapping of `serviceType`) throws on an unknown value, **drivers will silently
miss rental offers today**. Make unknown service types fall back to `ride`
before shipping anything else:

```dart
enum ServiceType { ride, parcel, intercity, hourlyRental }

ServiceType parseServiceType(String? value) {
  switch ((value ?? 'ride').toLowerCase()) {
    case 'parcel': return ServiceType.parcel;
    case 'intercity': return ServiceType.intercity;
    case 'hourly_rental': return ServiceType.hourlyRental;
    default: return ServiceType.ride; // never throw on new types
  }
}
```

---

## 1. How it works

| Step | Who | What happens |
|---|---|---|
| 1 | Rider | Picks a pickup, a package and a vehicle |
| 2 | Rider | `POST /rides` with `serviceType: "hourly_rental"` and `rental.packagePriceId` |
| 3 | Server | Reads the price from the package (ignores the app's `fare`), no bidding, no surge |
| 4 | Driver | Gets a normal `rideRequest` with a `rental` object; accepts, arrives, verifies OTP, starts |
| 5 | Driver | Taps **End trip** → emits status `arrived` |
| 6 | Server | Stops the clock, measures km from the GPS trail, adds overage to `fare`, emits `ride:state` with `rental.settledAt` |
| 7 | Driver | Collects the **updated** `fare`, then emits `completed` |

Overage is whole units only: `extraKm = floor(travelledKm − includedKm)`,
`extraMinutes = usedMinutes − includedMinutes`, each multiplied by the rate.

---

## 2. Data models

### 2.1 Catalog (rider)

`GET /users/hourly-rental-packages?lat=<lat>&lng=<lng>` (no auth needed)

```json
{
  "success": true,
  "results": [
    {
      "id": "6ad5fc52078446f4337777c7",
      "packageTypeId": "6ad5fc52078446f4337777c6",
      "name": "1 Hour / 10 KM",
      "description": "Quick errands around the city",
      "includedMinutes": 60,
      "includedKm": 10,
      "startingPrice": 300,
      "vehicles": [
        {
          "vehicleTypeId": "6ad20c5f922daf60d796aa1b",
          "vehicleName": "Maruti Suzuki Dzire",
          "category": "Sedan",
          "capacity": 4,
          "icon": "/vehicles/dzire.jpg",
          "iconType": "car",
          "price": 300,
          "includedKm": 10,
          "includedMinutes": 60,
          "extraKmRate": 25,
          "extraMinuteRate": 2,
          "cancellationFee": 0
        }
      ]
    }
  ]
}
```

- Sorted by duration. Vehicles sorted by price.
- `icon` can be relative (`/vehicles/dzire.jpg`); prefix it with
  `https://kranticabs.com` when it does not start with `http`.
- Empty `results` = rentals not offered at this pickup; show an empty state.

```dart
class RentalVehicle {
  final String vehicleTypeId, vehicleName, category, icon, iconType;
  final int capacity;
  final num price, includedKm, includedMinutes, extraKmRate, extraMinuteRate;
  RentalVehicle.fromJson(Map<String, dynamic> j)
      : vehicleTypeId = j['vehicleTypeId'] ?? '',
        vehicleName = j['vehicleName'] ?? 'Vehicle',
        category = j['category'] ?? '',
        icon = j['icon'] ?? '',
        iconType = j['iconType'] ?? '',
        capacity = (j['capacity'] ?? 0) as int,
        price = j['price'] ?? 0,
        includedKm = j['includedKm'] ?? 0,
        includedMinutes = j['includedMinutes'] ?? 0,
        extraKmRate = j['extraKmRate'] ?? 0,
        extraMinuteRate = j['extraMinuteRate'] ?? 0;
}

class RentalPackage {
  final String id, name, description;
  final num includedMinutes, includedKm, startingPrice;
  final List<RentalVehicle> vehicles;
  RentalPackage.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        name = j['name'] ?? '',
        description = j['description'] ?? '',
        includedMinutes = j['includedMinutes'] ?? 0,
        includedKm = j['includedKm'] ?? 0,
        startingPrice = j['startingPrice'] ?? 0,
        vehicles = ((j['vehicles'] ?? []) as List)
            .map((v) => RentalVehicle.fromJson(v))
            .toList();
}
```

### 2.2 `rental` on a ride (rider + driver)

Present on every ride payload when `serviceType == "hourly_rental"`, otherwise
`null`: `GET /rides/:id`, socket `ride:state`, socket `rideRequest`,
`GET /drivers/ride-offers`, the accept payload and ride history.

```json
"rental": {
  "packagePriceId": "6ad5fc52078446f4337777c7",
  "packageName": "1 Hour / 10 KM",
  "packagePrice": 300,
  "includedKm": 10,
  "includedMinutes": 60,
  "extraKmRate": 25,
  "extraMinuteRate": 2,
  "travelledKm": 0,
  "usedMinutes": 0,
  "extraKm": 0,
  "extraMinutes": 0,
  "extraKmCharge": 0,
  "extraTimeCharge": 0,
  "settledAt": null
}
```

`settledAt != null` means the bill is final and `ride.fare` already includes
`extraKmCharge + extraTimeCharge` (plus any airport parking added at
completion).

```dart
class RideRental {
  final String packagePriceId, packageName;
  final num packagePrice, includedKm, includedMinutes, extraKmRate, extraMinuteRate;
  final num travelledKm, usedMinutes, extraKm, extraMinutes, extraKmCharge, extraTimeCharge;
  final DateTime? settledAt;
  bool get isSettled => settledAt != null;

  static RideRental? maybe(dynamic j) =>
      (j is Map && (j['packagePriceId'] ?? '') != '') ? RideRental._(j.cast()) : null;

  RideRental._(Map<String, dynamic> j)
      : packagePriceId = j['packagePriceId'],
        packageName = j['packageName'] ?? '',
        packagePrice = j['packagePrice'] ?? 0,
        includedKm = j['includedKm'] ?? 0,
        includedMinutes = j['includedMinutes'] ?? 0,
        extraKmRate = j['extraKmRate'] ?? 0,
        extraMinuteRate = j['extraMinuteRate'] ?? 0,
        travelledKm = j['travelledKm'] ?? 0,
        usedMinutes = j['usedMinutes'] ?? 0,
        extraKm = j['extraKm'] ?? 0,
        extraMinutes = j['extraMinutes'] ?? 0,
        extraKmCharge = j['extraKmCharge'] ?? 0,
        extraTimeCharge = j['extraTimeCharge'] ?? 0,
        settledAt = j['settledAt'] != null ? DateTime.tryParse(j['settledAt']) : null;
}
```

Add `final RideRental? rental;` to the existing `Ride` and `RideRequest`
models and parse it with `RideRental.maybe(json['rental'])`.

---

## 3. Rider app

### 3.1 Entry point

The home grid comes from `GET /users/app-modules`. The live module
**"Car rental"** has `service_type: "rental"`, `transport_type: "taxi"`.
Route it like this (same rule as the web app):

```dart
String routeForModule(AppModule m) {
  final type = m.serviceType.toLowerCase();
  final name = m.name.toLowerCase();
  if (type == 'hourly_rental') return Routes.hourlyRental;
  if (type == 'rental') {
    final selfDrive = RegExp(r'bike|self[\s-]?drive|scooty').hasMatch(name);
    return selfDrive ? Routes.vehicleRental : Routes.hourlyRental;
  }
  // ... existing mapping
}
```

Note: if the app guesses a vehicle type from the label (e.g. "car" → cab),
check `rental` **before** that, or "Car rental" will open the normal ride flow.

### 3.2 `HourlyRentalScreen`

Layout (one screen, scrolls):

1. **Pickup**: default = current or last saved location; tap to open the
   existing place search. No drop field.
2. **Packages**: 2-column grid of chips: `"1 hr · 10 km"` / `"from ₹300"`.
   First package selected by default.
3. **Cabs**: list of the selected package's `vehicles` (image, name,
   category · seats, price). First selected by default.
4. **What's included**: `X hrs of cab time`, `Y km of travel`, and the note
   *"Beyond the package: ₹25 per extra km and ₹2 per extra minute. Tolls and
   parking are extra."* using `extraKmRate` / `extraMinuteRate`.
5. **Sticky button**: `Book <vehicle> · ₹<price>`, and below it
   *"Pay by cash at the end of the trip"*.

State to keep: `pickup (lat, lng, address)`, `packages`, `selectedPackageId`,
`selectedVehicleTypeId`, `loading/error`. Reload packages whenever the
pickup changes (city-specific prices can differ from the nationwide ones).

### 3.3 Booking

Same endpoint and searching flow as a normal ride:

```dart
final body = {
  'pickup': [pickup.lng, pickup.lat],
  'drop': [pickup.lng, pickup.lat],          // rental has no fixed drop
  'pickupAddress': pickup.address,
  'dropAddress': pickup.address,
  'fare': vehicle.price,                     // display only; server overrides
  'estimatedDistanceMeters': vehicle.includedKm * 1000,
  'estimatedDurationMinutes': vehicle.includedMinutes,
  'vehicleTypeId': vehicle.vehicleTypeId,
  'vehicleTypeIds': [vehicle.vehicleTypeId],
  'paymentMethod': 'Cash',
  'serviceType': 'hourly_rental',
  'transport_type': 'taxi',
  'bookingMode': 'normal',
  'rental': {'packagePriceId': package.id},
};
final res = await dio.post('/rides', data: body); // Bearer user token
```

Response is the same as a normal ride (`201`, `data.ride`, `data.realtime`),
then go to the existing **Searching driver** screen. Don't show the
bidding / raise-fare controls for rentals; the server sets
`pricingNegotiationMode: "none"`.

Errors to show as a toast and return to the package screen:

| Status | Message |
|---|---|
| 400 | `A rental package is required` |
| 404 | `This rental package is no longer available` (reload packages) |
| 400 | `This vehicle is not offered for the selected rental package` |

### 3.4 Tracking screen

When `ride.rental != null`:
- Replace the drop row with a **"Hourly rental · 1 Hour / 10 KM"** card.
- After `startedAt`: show elapsed vs included, e.g. `0:42 / 1:00 hr` with
  a progress bar. Compute elapsed locally from `startedAt`; it's display-only.
- Once `ride:state` arrives with `rental.settledAt`, show the bill (see 3.5).

### 3.5 Bill / ride complete / history

```
Package (1 Hour / 10 KM)           ₹300
Extra 2 km   (12.3 km driven)      ₹50
Extra 15 min (1 hr 15 min used)    ₹30
-----------------------------------------
Total                              ₹380   ← always ride.fare
```

- Always show `ride.fare` as the total; don't add the lines up yourself (the
  total may also include airport parking or a promo).
- History label: `"Hourly Rental"` when `serviceType == "hourly_rental"`.
  The `rides` history category already includes rentals.

---

## 4. Driver app

### 4.1 Incoming request card

When `request.rental != null`:
- Title: **"New hourly rental request"** (scheduled: "Scheduled hourly
  rental request").
- Subtitle: `rental.packageName`.
- Info row with 3 cells: **Package** `1 hr / 10 km` · **Extra km**
  `₹25/km` · **Extra time** `₹2/min`.
- Hide the drop address and the pickup→drop distance (drop == pickup).

The same `rental` object comes on the socket `rideRequest` and on
`GET /drivers/ride-offers`, so one `fromJson` covers both.

### 4.2 Active trip

- Heading-to-pickup, arrived, OTP and start steps are unchanged.
- **In trip**: instead of "Destination", show a rental card with the
  package, included km/time, a live `used` timer from `startedAt`, and the
  extra rates. Label the main button **"End trip"** (not "Arrived at
  destination"); the driver ends it wherever the rider asks.
- Tapping **End trip** emits the existing status update:

```dart
socket.emit('ride:status:update', {'rideId': rideId, 'status': 'arrived'});
```

### 4.3 Collect payment: use the server's fare

This is the one behaviour change that matters. The overage is added
**when `arrived` is processed**, so the fare on the cached request is out of
date by the time the payment screen shows.

```dart
socket.on('ride:state', (data) {
  if (data['rideId'] != currentRideId) return;
  final rental = RideRental.maybe(data['rental']);
  if (rental != null && rental.isSettled) {
    setState(() {
      fareToCollect = (data['fare'] as num);   // package + overage
      rentalBill = rental;
    });
  }
});
```

- On the **Collect payment** screen, show `fareToCollect` (fallback to the
  request fare only while waiting), plus the breakdown from `rentalBill`
  (same lines as 3.5).
- If the app was killed and reopened, `GET /rides/:id` returns the settled
  `rental` and updated `fare`; use those.
- Any payment QR / online-collection amount must use `fareToCollect`.
- Then emit `completed` as today.

### 4.4 Location updates

Overage km comes from the driver's GPS trail
(`ride:driver-location:update`, already sent during trips). Keep sending
updates while the trip is `started`, including in the background. A gap in
updates means fewer km measured, which goes against the driver, not the rider.

---

## 5. Admin (no app work)

Packages are managed on the web admin:
**Price Management → Package Pricing → Package Kind: Hourly Rental**.
Base price = package price, Free distance (km) / Free time (min) = what's
included, Distance price / Time price = per extra km / per extra minute.
Changes apply to new bookings immediately; no app release needed.

---

## 6. Test checklist

- [ ] Old driver app build receives a rental offer without crashing (§0).
- [ ] Catalog loads for an Indore pickup, shows 5 packages × 5 cabs.
- [ ] Booking with a tampered `fare` still creates the ride at the package price.
- [ ] Driver sees the rental card on the request and in the trip.
- [ ] End trip at 75 min / ~12 km on the 1 hr / 10 km package → bill
      ₹300 + ₹50 + ₹30 = ₹380 on both apps before the payment step.
- [ ] Ending inside the package → no extra charge.
- [ ] Reopening the driver app on the payment screen still shows ₹380.
- [ ] Rider history shows "Hourly Rental" with the breakdown.
