# Driver app – accepting and rejecting ride offers (with auto clicker protection)

This covers how the Flutter driver app accepts or rejects a ride offer, over the
socket or REST, and what the app must do so the server-side protection against
auto clickers and scripted accepts works without hurting honest drivers.

Base URL: `https://kranticabs.com/api/v1`. All REST calls need
`Authorization: Bearer <driver access token>`.

## What the server now enforces

Every accept, from the socket or REST, goes through the same checks:

| Rule | What the driver sees |
|---|---|
| One ride, one driver: the first successful accept wins, atomically | Everyone else gets **ride no longer available** |
| Only a driver the ride was **offered** to, and who has **not rejected** it, can accept | **Ride no longer available** (`code: RIDE_NOT_OFFERED`) |
| Max **10 accept attempts per 10 seconds** per driver | `429`, `code: RIDE_ACCEPT_RATE_LIMITED` |
| The driver who already won accepting again (a retry) | The same success response again, nothing repeated |
| Each attempt's reaction time (offer sent → accept received, server clock) is logged | Nothing. Admins review it under Driver Management → Accept Speed Review. Nobody is blocked automatically |

A normal driver never sees the rate limit or `RIDE_NOT_OFFERED`. Those only
show up for scripts, auto clickers, or app bugs (for example, accepting a ride
the driver already rejected).

---

## 1. Accept

### Over the socket (app open)
Emit:
```json
acceptRide  { "rideId": "6ada…" }
```
On success the server sends, to this socket:

- `rideAccepted`, then `ride:state`, both with
  `{ "rideId", "room", "status": "accepted", "liveStatus": "accepted", "acceptedAt" }`
- `ride:joined` `{ "rideId", "room" }`. Over the socket the server already put the driver in the ride room.

On failure it sends `errorMessage`:
```json
{ "message": "Ride is no longer available for acceptance", "code": "RIDE_UNAVAILABLE" }
```
`code` is new and optional. Older servers send only `message`.

### Over REST (native offer card, app closed)
```
POST /drivers/ride-offers/:rideId/accept
Authorization: Bearer <driver token>
```
No body.

**200**
```json
{
  "success": true,
  "data": {
    "rideId": "6ada…",
    "status": "accepted",
    "liveStatus": "accepted",
    "acceptedAt": "2026-10-23T08:12:31.402Z"
  }
}
```
**409 – ride no longer available** (someone else won, the rider cancelled, the
search ended, or the ride was not offered to / was rejected by this driver):
```json
{
  "success": false,
  "message": "Ride is no longer available for acceptance",
  "details": { "code": "RIDE_UNAVAILABLE" }
}
```
`details.code` is `RIDE_UNAVAILABLE` or `RIDE_NOT_OFFERED`. Treat both the same:
close the card.

**409 – this driver can't take it right now.** Same shape, a different message
and no `code`. For example: driver offline, already on a ride, wallet blocked,
a scheduled trip too close, "Another ride was accepted a moment before this
one". Show the `message` and close the card.

**429 – too many attempts**
```json
{
  "success": false,
  "message": "Too many accept attempts. Wait a few seconds and try again.",
  "details": { "code": "RIDE_ACCEPT_RATE_LIMITED", "retryAfterSeconds": 7 }
}
```

**401** `Authorization token is required` (or another auth message): log the
driver in again. **403** `Insufficient permissions for this resource` (not a
driver token) or `Driver account is pending approval`.

After a REST accept the driver is **not** in the ride's socket room. When the
app opens the trip, connect the socket and join the room the way it does for
any active ride (load it with `GET /rides/active/me`).

## 2. Reject
Socket: `rejectRide { "rideId" }`. REST (offer card):
```
POST /drivers/ride-offers/:rideId/reject
```
**200** `{ "success": true, "data": { "rideId": "6ada…" } }`

Once a driver rejects, they are never offered that ride again, and **accepting it
afterwards is refused** (`RIDE_NOT_OFFERED`). Don't show an "undo" on a reject.

---

## 3. What the app must do

### One accept per tap, and no retrying on a timer
```dart
bool _accepting = false;

Future<void> onAcceptTapped(String rideId) async {
  if (_accepting) return;                 // swallow double taps
  setState(() => _accepting = true);      // disable the button, show a spinner
  try {
    final res = await api.acceptRide(rideId);   // POST …/accept
    openTrip(res.rideId);
  } on ApiException catch (e) {
    switch (e.statusCode) {
      case 409:
        closeOfferCard();
        showSnack(e.code == null ? e.message : 'Ride is no longer available');
        break;
      case 429:
        showSnack('Please wait a moment');      // never auto-retry
        break;
      case 401:
        goToLogin();
        break;
      case 403:
        showSnack(e.message);
        break;
      default:
        await _resolveUncertainAccept(rideId);
    }
  } on TimeoutException {
    await _resolveUncertainAccept(rideId);
  } on SocketException {
    await _resolveUncertainAccept(rideId);
  } finally {
    if (mounted) setState(() => _accepting = false);
  }
}
```

### Network error or timeout: ask the server, don't guess
The accept may have gone through even though the response was lost. Before
showing an error or letting the driver tap again:

```dart
Future<void> _resolveUncertainAccept(String rideId) async {
  final active = await api.getActiveRide();   // GET /rides/active/me
  if (active?.id == rideId) {
    openTrip(rideId);                          // it worked
  } else {
    // Still offered? Let the driver try once more by hand.
    showSnack('Connection problem - tap Accept again if the offer is still open');
  }
}
```
A second accept for a ride this driver already won is safe now. It returns the
same 200, so a single manual retry is fine too.

**Never** retry accepts automatically in a loop or on a timer. The server counts
every attempt; a retry loop looks like an auto clicker, hits the 429, and puts the
driver on the admin review list.

### Use the server's countdown
Offers from `GET /drivers/ride-offers` carry `expiresInSeconds` and
`requestExpiresAt` (server time). Count the card down from those, not from when
the phone happened to receive the push.

---

## 4. Android: block taps through overlays (recommended)

Some tools work by drawing an invisible window over the app and tapping through
it. Android can ignore touches that arrive while another app's window covers the
screen. Turn that on for the offer card and its Accept button.

**Native (simplest, no plugin).** In `MainActivity.kt`:
```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Drop touches while another app's window obscures ours (tapjacking).
    window.decorView.filterTouchesWhenObscured = true
}
```
Do the same on the activity or view that shows the full-screen native offer card
if it's a separate one.

**Or the `no_tapjack` plugin** (pub.dev), which also reports when an overlay is
detected. Check its current version and API before adopting it. When it reports
an overlay, show "Close other apps drawing over the screen to accept rides" and
disable Accept until the overlay is gone. Don't send anything to the server and
don't block the driver for it. Screen-dimmers, chat bubbles and accessibility
apps also draw overlays.

Test on Android 10–15 with: a chat-head app, a screen-filter app, a system call
screen, and an auto clicker app. Write down which ones are blocked.

**What this does not do:** an auto clicker that taps without an overlay (through
accessibility services) still gets through. That's why the server checks above
exist. This is risk reduction, not a guarantee.

## 5. Optional later: Google Play Integrity
If the driver app ships through Google Play, the app can request a Play Integrity
token and send it with the accept (for example as `X-Play-Integrity`). The server
then checks it with Google. This needs Google Cloud setup and server work that is
**not built yet**. Ask the backend team before adding it.

---

## 6. Test checklist
- [ ] Double-tap Accept fast: one request goes out, the trip opens once
- [ ] Two drivers accept the same ride: one gets the trip, the other sees "Ride is no longer available" and the card closes
- [ ] Reject, then make the offer card show again somehow and tap Accept: refused, card closes
- [ ] Airplane mode right after tapping Accept: on reconnect the app checks `/rides/active/me` and opens the trip if it was won
- [ ] App closed, accept from the native card: trip opens, and once the app is open the live tracking works (socket room joined)
- [ ] Hammer Accept with an auto clicker on a test ride: at most 10 attempts are processed, then "Please wait a moment". The driver appears in Admin → Driver Management → Accept Speed Review
- [ ] With an overlay app drawing over the card (Android): Accept taps are ignored, and a message explains why
