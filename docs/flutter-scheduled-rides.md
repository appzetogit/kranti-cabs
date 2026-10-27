# Scheduled rides (ride later / outstation departure) – Flutter implementation guide

A rider books a ride for later (30 minutes to 30 days ahead). It does **not** pop
up on drivers as a ride-now request: it waits in drivers' **Scheduled Rides**,
where one can take it in advance, and becomes the live trip 30 minutes before
pickup – as on Ola / Uber.

Base URL: `https://kranticabs.com/api/v1`. Socket: `https://kranticabs.com`.

> **Backend: live** (kranti-cabs `f382662`, `513ac38`). Checked end to end on a
> real server with a scripted rider and driver: 37/37.
>
> **App code: on `main`** of `kranti_cabs_flutterproject` (`92b28dc`, `43abdfa`),
> **not compiled yet** – run `flutter analyze` on both apps and build.

---

## 0. Why it looks broken on the phones today

Every outstation booking from the installed rider app reaches the server with
**no departure time**:

```json
"scheduledAt": null, "intercity": { "travelDate": "", "returnDate": "2026-10-27T12:56:00.000Z" }
```

A ride without `scheduledAt` is a ride **now**, so it pops up on the driver and
never reaches Scheduled Rides. The old outstation screen only asked for a
**return** date. The fix is the "Leave on" picker below, which is in `main` but
not in any installed build yet.

---

## 1. Server rules

| `scheduledAt` (UTC ISO) | Result |
|---|---|
| missing, or under 5 min ahead | Ride now |
| 5 – 15 min ahead | `400 SCHEDULE_TOO_SOON` |
| 15 min – 30 days ahead | Scheduled ride |
| over 30 days | `400 SCHEDULE_TOO_FAR` |

**Timeline of a scheduled ride:**

1. **Booked:** no popup. Listed in `GET /drivers/scheduled-rides` for drivers of the
   same vehicle type in the same city. Nearby drivers get a push:
   `type=scheduled_ride_available`, `scheduledRideId`, `scheduledAt`.
2. **Taken in advance** (`POST /drivers/ride-offers/:id/accept`): the rider gets a
   push "Driver assigned" (`type=scheduled_ride_assigned`, `scheduledRideId`) and
   **no** `rideAccepted` socket event, so the rider app stays off the tracking
   screen. The driver stays free for rides now until then.
3. **30 min before pickup:** it becomes the active trip for both apps
   (`GET /rides/active/me`). Driver push "Head out now"
   (`type=scheduled_ride_reminder`, `scheduledRideId`); rider push "Your driver is
   heading to the pickup" (`type=scheduled_ride_starting`, **`rideId`** → tracking).
4. **Nobody took it:** 15 min before pickup it goes out as a normal `rideRequest`
   (the payload has `scheduledAt`).
5. **Driver gives it back** (`POST /drivers/scheduled-rides/:id/cancel`): the ride is
   **not** cancelled. It goes back to searching for other drivers; the rider gets
   "Finding you another driver" (`type=scheduled_ride_driver_changed`,
   `scheduledRideId`). The driver who gave it back no longer sees it.
6. **Rider cancels** a ride a driver took: that driver gets a push
   (`type=scheduled_ride_cancelled`, `scheduledRideId`).

> Pushes about a ride that is not live yet carry **`scheduledRideId`, never
> `rideId`** – the driver app treats a push with `rideId` as a new offer, and the
> rider app opens it as live tracking.

---

## 2. Rider app (`Kranti_cabs`) – already on `main`

| File | Change |
|---|---|
| `search_destination_screen.dart` | Outstation "**Leave on**" row (Now / date & time) → `setScheduledAt()`. 30 min – 30 days. Return must be ≥ 1 h after leaving. Entering the screen clears an old time / return. |
| `schedule_ride_sheet.dart` | 30 min minimum. Pops the time, `ScheduleRideSheet.rideNow` for "Ride now instead", or `null` when dismissed (keeps the time). |
| `ride_type_screen.dart` | Handles those values; after a scheduled booking calls `controller.reset()` and goes to `/rides` (no search left running). |
| `booking_controller.dart` | `SCHEDULE_TOO_SOON` / `SCHEDULE_TOO_FAR` show the message, not "no driver found"; fare re-priced when departure / return change; `travelDate` / `returnDate` sent in UTC. |
| `ride_repository.dart` | `scheduledAt.toUtc().toIso8601String()` |
| `main.dart` | A push with `scheduledRideId` opens `/ride/detail/<id>`, not tracking. |

## 3. Driver app (`kranticabs_driver`) – already on `main`

| File | Change |
|---|---|
| `auth_providers.dart` | Push `scheduled_ride_available` opens `/scheduled-rides`. |
| `active_ride_screen.dart` | Accepting no longer auto-opens Google Maps when pickup is more than 30 min away. |
| `scheduled_rides_screen.dart` | Labels hourly rentals; "Give back" now really returns the ride to other drivers (server). |

---

## 4. Test on a phone

| # | Steps | Expected |
|---|---|---|
| a | Outstation, Leave on = tomorrow 10 AM, round trip | No popup on the driver; it is in the driver's Scheduled Rides; on the server `scheduledAt` is set |
| b | Driver taps "Take ride" | Rider gets "Driver assigned" and stays off tracking; driver's phone does not open Google Maps |
| c | Ride later 10 min ahead | Sheet blocks it (30 min minimum) |
| d | Leave on = Now | Pops up on the driver as before |
| e | Round trip, change the return date | Fare goes up with the number of days |
| f | Set a Ride-later time, swipe the sheet closed | Time is kept |
| g | Driver takes a scheduled ride, then "Give back" | Rider is not cancelled; another driver sees it in Scheduled Rides |
