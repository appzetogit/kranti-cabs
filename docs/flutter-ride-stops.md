# Stops on a ride – Flutter implementation guide

A rider can add **up to 3 stops** between pickup and drop, as on Ola / Uber. The
driver sees them on the offer and the trip, and navigation goes through them.

Base URL: `https://kranticabs.com/api/v1`. Socket: `https://kranticabs.com`.

> **Backend: live** since commit `0b71c84` (kranti-cabs `main`, 27 Oct 2026).
> Bookings without stops behave exactly as before; older rides return `stops: []`.

---

## 1. What the server does

- `POST /rides` takes `stops` and saves them **in order** on the ride.
- Up to **3**. A 4th is refused with `400`, code `TOO_MANY_STOPS`, message
  "You can add up to 3 stops". The refusal happens before anything changes, so it
  never cancels the ride the rider is already on.
- Entries without a usable position are dropped (not an error).
- The route is resolved **pickup → stops → drop**.
- **Fare:** for city rides the server uses the fare the app sends, so the app's
  quote must already include the distance through the stops. The rider app's
  `BookingController._recalculateRoute` already does this.
- Hourly rentals take no stops (they have no drop); any sent are ignored.

### Sending stops (rider app)

```json
"stops": [
  { "lat": 22.7196, "lng": 75.8577, "address": "Rajwada, Indore" },
  { "lat": 22.7533, "lng": 75.8937, "address": "C21 Mall, Vijay Nagar" }
]
```

Also accepted: `{ "location": { "coordinates": [lng, lat] }, "address": "…" }` or
a bare `[lng, lat]`.

### Receiving stops (both apps)

Every ride object now has:

```json
"stops": [
  { "lat": 22.7196, "lng": 75.8577, "address": "Rajwada, Indore",
    "location": { "type": "Point", "coordinates": [75.8577, 22.7196] } }
]
```

It is in: the driver `rideRequest` socket offer, `ride:state`, `GET /rides/active/me`,
ride details and history, `GET /drivers/scheduled-rides`, and admin ride details.

The driver's **offer push** (data-only, strings) carries:

| key | example |
|---|---|
| `stopsCount` | `"2"` |
| `stopsSummary` | `"Rajwada, Indore \| C21 Mall, Vijay Nagar"` |

---

## 2. Rider app (`Kranti_cabs`)

Already there: `BookingState.stops`, `BookingController.setStops()`, the
distance/fare through stops, stop markers on the vehicle screen, and
`ride_repository.createRide` sending `stops`. **What is missing is a way to add
them.**

1. `search_destination_screen.dart` – there is `_stops` and
   `FieldTarget.stop(index)`, but nothing ever adds to `_stops`.
   - Add **"+ Add stop"** under the drop field (hidden at 3 stops, hidden for Rental).
   - Each tap inserts an empty stop field between pickup and drop.
   - Tapping a stop field searches with `_activeTarget = FieldTarget.stop(i)`; the
     existing selection code already writes into `_stops[i]`.
   - Each stop row has an **X** to remove it.
   - The screen already calls `setStops(validStops)` before moving on.
2. `ride_type_screen.dart` – show "via Rajwada, C21 Mall" under the route summary.
3. Tracking / ride details – `RideModel` already parses `stops`; list them between
   pickup and drop.
4. Show the message for `TOO_MANY_STOPS` (cannot happen while the button caps at 3).

---

## 3. Driver app (`kranticabs_driver`)

Already there: `RideModel.stops` parses the list, and `active_ride_screen.dart`
draws a pin per stop. Please add:

1. **Offer popup** (`ride_request_screen.dart`): a "via" line –
   "2 stops: Rajwada, Indore | C21 Mall".
2. **Native offer card** (`RideOfferPayload.kt` / `RideOfferActivity`): read push
   data `stopsCount` and `stopsSummary` and show "via …" when `stopsCount > 0`.
3. **Trip screen**: list the stops in order between pickup and drop.
4. **Navigation through the stops.** `google.navigation:` has no waypoints, so when
   the ride has stops use the directions URL:

   ```dart
   final waypoints = ride.stops.map((s) => '${s.lat},${s.lng}').join('|');
   final uri = Uri.parse(
     'https://www.google.com/maps/dir/?api=1'
     '&destination=${ride.dropLat},${ride.dropLng}'
     '&waypoints=${Uri.encodeComponent(waypoints)}'
     '&travelmode=driving',
   );
   ```

   Keep `google.navigation:` for rides without stops, and for the leg to pickup.
5. **Scheduled Rides** card: "N stops" when there are any.

---

## 4. Test

| # | Steps | Expected |
|---|---|---|
| a | Book Palasia → Bombay Hospital with stops Rajwada and C21 Mall | Driver popup shows both stops; trip map shows 2 stop pins; Maps goes through them |
| b | Try to add a 4th stop | Button hidden |
| c | Add 2 stops, remove one, book | Only the remaining stop reaches the driver |
| d | Rental | No Add stop button |
| e | Book without stops | Exactly as before |

Server check (live route service): Palasia → Bombay Hospital is 5.6 km / 8 min
direct and 11.9 km / 17 min via Rajwada and C21 Mall.
