# Driver app – Go Home (destination mode) – Flutter implementation guide

A driver saves their **home**, taps **Go Home**, and from then on is offered only
rides that take them that way. They can also head to another place instead of
home.

Base URL: `https://kranticabs.com/api/v1`. Every call needs
`Authorization: Bearer <driver access token>`.

> **Already in the app:** commit `c07a4aa` in `kranti_cabs_flutterproject`
> (`kranticabs_driver/lib/features/destination/`) implements everything below,
> but it has **not been compiled yet**. Use this guide to review it, build it,
> and test it. Section 6 lists what is still optional.

---

## 1. What the server does

When Go Home is turned on, the server gets the driver's **road route** from where
they are now to the destination (Google Directions) and stores it. Dispatch then
offers this driver a ride only when:

1. the ride's **pickup and drop are both within 2 km** of that route, and
2. the **drop is further along** the route than the pickup, and the pickup is not
   behind the driver (the ride moves them forward, never back), and
3. driver → pickup → drop → destination is **at most 30% longer** than going
   straight there.

Drivers who don't have Go Home on are matched as before. While it's on, a driver
also doesn't appear in the rider's "cars nearby" map.

It **turns off by itself**:
- within **500 m of the destination**, once the driver has no rider on board, or
- after **3 hours**.

In both cases the driver gets a push notification (section 4). If the driver leaves
the route, the server plans a new one from where they are. **Limits:** Go Home can
be turned on **once a day**. Home can be moved **any time** (the admin can set a
waiting period; it's 0 live).

All the numbers are admin settings (Admin → Transport Ride Settings → Destination
mode). Always use what the API returns; never hard-code them.

The route starts from the driver's **last location sent over the socket**. So the
driver must be online with GPS on. Otherwise the API answers `NO_DRIVER_LOCATION`.

---

## 2. Endpoints

### Get the state
```
GET /drivers/me/destination
```
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "destination": { "lat": 22.7533, "lng": 75.8939, "label": "Vijay Nagar, Indore", "isHome": true },
    "routePolyline": "y`ijCq~ekM…",
    "routeDistanceMeters": 5651,
    "startedAt": "2026-10-26T12:40:03.000Z",
    "expiresAt": "2026-10-26T15:40:03.000Z",
    "home": { "lat": 22.7533, "lng": 75.8939, "address": "Vijay Nagar, Indore", "updatedAt": "2026-10-20T08:11:00.000Z" },
    "canChangeHomeAt": "2026-10-27T08:11:00.000Z",
    "featureEnabled": true,
    "usesPerDay": 1,
    "usedToday": 1
  }
}
```
| Field | Meaning |
|---|---|
| `enabled` | Go Home is on right now |
| `destination` | Where they're heading. `null` when off |
| `routePolyline` | Google encoded polyline of the stored route. Empty when off. Optional: draw it on the map |
| `expiresAt` | When it turns off by itself |
| `home` | Saved home, or `null` if none |
| `canChangeHomeAt` | When home can next be moved. `null` = can move now |
| `featureEnabled` | Admin switch. **Hide the whole Go Home UI when `false`** |
| `usesPerDay` / `usedToday` | Daily limit (`0` = no limit) and today's count |

### Go Home / go somewhere / turn off
```
PUT /drivers/me/destination
{ "enabled": true, "useHome": true }                                   // Go Home
{ "enabled": true, "lat": 22.75, "lng": 75.95, "label": "Market" }      // another place
{ "enabled": false }                                                   // turn off
```
**200**: the same object as `GET`, now updated.

### Save home
```
PUT /drivers/me/home-location
{ "lat": 22.7533, "lng": 75.8939, "address": "Vijay Nagar, Indore" }
```
**200**: the same object as `GET`, with the new `home`. Re-saving the same spot
(within 50 m) never counts as a move.

### Errors
Every error looks like this:
```json
{ "success": false, "message": "You've used destination mode 1/1 times today.", "details": { "code": "DESTINATION_DAILY_LIMIT", "usesPerDay": 1 } }
```
`message` is written to show to the driver as-is. `details.code` is there if you
want to branch on it.

| HTTP | `details.code` | When | App |
|---|---|---|---|
| 403 | `DESTINATION_MODE_OFF` | Admin switched the feature off | Hide Go Home, refresh |
| 400 | `HOME_NOT_SET` | `useHome` with no saved home | Open the Home Location screen |
| 400 | `NO_DRIVER_LOCATION` | Server has no location for the driver yet | "Go online and try again" |
| 400 | `ALREADY_AT_DESTINATION` | Already within 500 m | Show the message |
| 429 | `DESTINATION_DAILY_LIMIT` | Used up for today | Show the message, disable the button |
| 502 | `NO_ROUTE` | Google found no road route | Show the message, let them retry |
| 429 | `HOME_CHANGE_TOO_SOON` | Moving home before `nextChangeAt` (also in `details`) | Show the message |
| 401 / 403 | – | Bad token / not a driver | Usual auth handling |

---

## 3. Screens

### Home screen: Go Home card
In the app this is `GoHomeCard`, placed under the subscription card. It's hidden
when `featureEnabled` is false.

The card has an **on/off switch** for "On the way home rides":

| State | Shows | Control |
|---|---|---|
| No home saved | "On the way home rides. Save your home to get rides on the way there." | **Set home** link, which opens the Home Location screen |
| Home saved, off | "Turn on to get only rides towards home · *n* left today" | Switch **off**. Greyed out when no uses are left today |
| On | "Heading to Vijay Nagar. Only rides on your way. Turns off when you arrive." | Switch **on**. Turning it off calls `{ enabled: false }` |

Turning the switch on calls `PUT /drivers/me/destination { enabled: true, useHome: true }`.
Show a spinner in place of the switch while the request is in flight. On an error,
show `message` and leave the switch as it was.

### Profile → Home Location
In the app this is `HomeLocationScreen`, route `/home-location`.
- Shows the saved home. Home can be changed any time. Only if the admin sets a
  waiting period does the screen show "You can move home again from *date*" (while
  `canChangeHomeAt` is in the future) and disable both buttons until then.
- **Use where I am now:** asks for location permission, takes a GPS fix, looks up a
  readable address (`placemarkFromCoordinates`), then confirms.
- **Type an address:** looks it up with `locationFromAddress` and confirms.
- The confirm dialog shows the address (and the home it replaces, if any). Then it
  calls `PUT /drivers/me/home-location`.

---

## 4. Keeping the card in sync
The server can switch Go Home off by itself. Refresh the state:
- when the home screen opens and when the app returns to the foreground,
- every minute while `enabled` is true (the app already does this in
  `DestinationModeNotifier`),
- when this push arrives:
  ```json
  { "type": "destination_mode_ended", "reason": "arrived" }
  ```
  `reason` is `arrived` or `expired`. The notification's own title and body are
  already written for the driver ("You've reached Vijay Nagar. You'll get all
  nearby rides again."). Handling it is optional; the one-minute refresh covers it.

---

## 5. Suggested Dart (matches the app)
```dart
// lib/features/destination/data/destination_repository.dart
Future<DestinationModeInfo> goHome() async =>
    _parse(await _api.put('/drivers/me/destination', data: {'enabled': true, 'useHome': true}));
Future<DestinationModeInfo> turnOff() async =>
    _parse(await _api.put('/drivers/me/destination', data: {'enabled': false}));
Future<DestinationModeInfo> setHome({required double lat, required double lng, required String address}) async =>
    _parse(await _api.put('/drivers/me/home-location', data: {'lat': lat, 'lng': lng, 'address': address}));
```
`ApiClient` had no `put`. Commit `c07a4aa` adds one next to `patch`.

---

## 6. Optional extras (not built)
- Draw `routePolyline` on the home-screen map while Go Home is on.
- "Going somewhere else?": a place search that calls `PUT /drivers/me/destination`
  with `lat`, `lng` and `label`. The server already supports it.
- Handle the `destination_mode_ended` push to refresh the card immediately.

---

## 7. Test checklist
Admin first: **Transport Ride Settings → Destination mode: On**, 1 use per day.

- [ ] No home saved: the card says "Set home", and Go Home isn't offered
- [ ] Save home from GPS: the address is shown and confirmed, and Profile shows it
- [ ] Move home again straight away: saves fine, and the dialog names the home it replaces
- [ ] Online, switch "On the way home rides" on: the card shows "Heading to …"
- [ ] A test ride along the way home reaches this driver; a ride going the other way does not
- [ ] Switch it off, then try to switch it on again the same day: "You've used destination mode 1/1 times today." (the switch is greyed out)
- [ ] Drive to within 500 m of home with no rider: within about a minute the switch goes back to off, and a push arrives
- [ ] Admin switches the feature off: the card disappears after a refresh
