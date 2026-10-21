# Rider cancellation reasons – Flutter implementation guide

When a rider cancels a trip, they now pick a reason from a list the admin keeps
under **Admin → App Settings → Cancellation Reasons**. The web rider app already
does this. This guide covers what the Flutter **rider** app needs to do.

Base URL: `https://kranticabs.com/api/v1`.

The backend still accepts a cancel with no reason, so the current app keeps
working. Ship this so the admin actually sees why rides are cancelled.

---

## 1. How it works

| Step | What happens |
|---|---|
| 1 | Rider taps **Cancel** (while searching, or after a captain is assigned) |
| 2 | App loads the reasons for that stage: `GET /users/cancellation-reasons?audience=user&stage=…` |
| 3 | Rider must pick one. An **Other** choice is always shown at the end, with a text box |
| 4 | App sends `PATCH /rides/:rideId/cancel` with the chosen reason |
| 5 | The reason is saved on the ride, shown to admin in Trip Details, and its label is sent to the assigned driver |

The admin can keep separate lists for the two stages. A reason marked "Any time"
appears in both.

| `stage` | Use when |
|---|---|
| `before_driver` | The ride is still searching (no `driverId`) |
| `after_driver` | A captain has accepted (the ride has a `driverId`) |

---

## 2. Load the reasons

```
GET /users/cancellation-reasons?audience=user&stage=before_driver
```

No auth needed. The response is already filtered to active rider reasons for that
stage and sorted in the admin's order:

```json
{
  "success": true,
  "data": {
    "results": [
      { "id": "65a0…01", "title": "Driver is taking too long", "audience": "user",
        "stage": "after_driver", "requiresNote": false, "order_by": 1, "active": true },
      { "id": "65a0…03", "title": "Wrong pickup location", "audience": "user",
        "stage": "any", "requiresNote": true, "order_by": 2, "active": true }
    ]
  }
}
```

- `requiresNote: true` means the rider must type a note when picking this reason.
- Fetch the list every time the sheet opens, because the admin can change it at any time.
- If the request fails or the list is empty, show only **Other** with an
  *optional* text box, and let the cancel go through. Never block a cancel
  because the list didn't load.

---

## 3. Cancel with the reason

```
PATCH /rides/:rideId/cancel
Authorization: Bearer <user token>
Content-Type: application/json
```

| Rider chose | Body |
|---|---|
| A listed reason | `{ "reasonId": "<id>", "reason": "<title>" }` |
| A listed reason with `requiresNote` | `{ "reasonId": "<id>", "reason": "<title>", "note": "<typed text>" }` |
| Other | `{ "reasonId": "other", "note": "<typed text>" }` (the note is required) |
| Nothing, because the list was empty | `{}` or `{ "note": "<typed text>" }` |

Always send `reason` (the title the rider saw) along with `reasonId`. If the
admin deleted that reason while the sheet was open, the server records the
title instead of rejecting the cancel. Notes are cut to 300 characters.

Success:

```json
{ "success": true,
  "data": { "rideId": "…", "status": "cancelled", "liveStatus": "cancelled",
            "cancelReason": "Wrong pickup location: pin was on the other side" } }
```

### Errors (the ride is **not** cancelled; keep the sheet open)

| HTTP | `details.code` | Show |
|---|---|---|
| 400 | `CANCEL_REASON_NOTE_REQUIRED` | `message`. The rider picked Other or a `requiresNote` reason without typing anything |
| 400 | `CANCEL_REASON_INVALID` | `message`, then reload the list. The id is unknown, inactive, or for the other stage, and no `reason` text was sent |
| 404 | `RIDE_NOT_FOUND` | Ride is gone. Clear the local ride state |

All errors use the shape `{ "success": false, "message": "…", "details": { "code": "…" } }`.
For any other error (for example, the ride already completed), keep the
existing behaviour: clear the local ride and go home.

---

## 4. Suggested Dart

```dart
class CancelReason {
  final String id, title, stage;
  final bool requiresNote;
  CancelReason.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        title = j['title'] as String? ?? '',
        stage = j['stage'] as String? ?? 'any',
        requiresNote = j['requiresNote'] == true;
}

String cancelStageFor(Ride ride) =>
    (ride.driverId ?? '').isEmpty ? 'before_driver' : 'after_driver';

Future<List<CancelReason>> loadCancelReasons(String stage) async {
  try {
    final res = await dio.get('/users/cancellation-reasons',
        queryParameters: {'audience': 'user', 'stage': stage});
    final list = (res.data['data']?['results'] as List?) ?? const [];
    return list.map((e) => CancelReason.fromJson(e)).toList();
  } catch (_) {
    return const []; // cancelling must still work
  }
}

Map<String, dynamic> cancelBody({CancelReason? picked, bool other = false, String note = ''}) {
  final body = <String, dynamic>{};
  if (picked != null) {
    body['reasonId'] = picked.id;
    body['reason'] = picked.title;
  } else if (other) {
    body['reasonId'] = 'other';
  }
  if (note.trim().isNotEmpty) body['note'] = note.trim();
  return body;
}
```

Validate on the device before sending: a reason must be picked when the list
isn't empty, and a note is needed for **Other** or a `requiresNote` reason.

---

## 5. Driver app

No change is required. When the rider cancels an assigned ride, the driver's
`rideRequestClosed` socket event now carries the reason:

```json
{ "rideId": "…", "reason": "user-cancelled",
  "message": "Rider cancelled: Driver is taking too long",
  "cancelReason": "Driver is taking too long" }
```

If the driver app already shows `message`, drivers will see the reason.
The rider's typed note is never sent to the driver. Only admin sees it.

---

## 6. Test checklist

- [ ] Cancel while searching shows the `before_driver` list plus **Other**
- [ ] Cancel after a captain accepts shows the `after_driver` list plus **Other**
- [ ] **Yes, Cancel** is refused until a reason is picked, and **Other** needs text
- [ ] Admin → Trips → Trip Details shows *Cancelled By: Rider* and the reason
- [ ] Turning a reason off in admin removes it from the app on the next open
- [ ] With no reasons configured (or offline list), the rider can still cancel
