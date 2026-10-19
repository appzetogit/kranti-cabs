# Rider KYC (QuickeKYC) – Flutter implementation guide

The backend and web app now support rider identity verification through
QuickeKYC. An admin switches it on, picks which documents are accepted and
when verification is required. This guide covers what the Flutter **rider
app** needs. The driver app needs no changes.

Base URL: `https://kranticabs.com/api/v1`. All endpoints below except
`/users/kyc/config` need the rider's `Authorization: Bearer <token>`.

---

## 1. How it works

| Admin setting (`requiredFor`) | What the rider sees |
|---|---|
| `optional` | Nothing is blocked. "Verify Identity" in profile; badge once verified |
| `after_signup` | App opens the KYC screen after login (once per session); bookings blocked until verified |
| `before_booking` | Any booking returns `KYC_REQUIRED` until verified |
| `rental_outstation` | Only `hourly_rental` and `intercity` bookings need KYC |

Documents (only the ones the admin allows are returned):

| `type` | Flow | Rider enters |
|---|---|---|
| `aadhaar` | `otp` – two steps | 12-digit Aadhaar, then the OTP sent to the Aadhaar-linked mobile |
| `pan` | `instant` | PAN, e.g. `ABCDE1234F` |
| `driving_license` | `instant` | Licence number **and** date of birth (`needsDob: true`) |
| `voter_id` | `instant` | EPIC number, e.g. `ABC1234567` |

The server stores only the last four digits (`maskedNumber`), never the full
number. A name that doesn't match the profile, or a document already used on
another account, goes to **admin review** (`needs_review`) instead of
verified.

When the admin runs in **mock mode** (before QuickeKYC keys are live), any
valid-format number passes and the Aadhaar OTP is `123456`. The OTP response
then includes `mockOtp`; show it as a hint.

---

## 2. API

All responses look like `{ "success": true, "data": { ... } }`. Errors look
like `{ "success": false, "message": "...", "details": { "code": "..." } }`.
Show `message` to the rider.

### 2.1 Status + config (load the screen with this)

`GET /users/kyc/status`

```json
{
  "status": "not_started",
  "isVerified": false,
  "documentType": "",
  "documentLabel": "",
  "maskedNumber": "",
  "verifiedName": "",
  "verifiedAt": null,
  "failureReason": "",
  "underReview": false,
  "config": {
    "enabled": true,
    "requiredFor": "before_booking",
    "documents": [
      { "type": "aadhaar", "label": "Aadhaar", "flow": "otp", "hint": "12-digit Aadhaar number" },
      { "type": "pan", "label": "PAN", "flow": "instant", "hint": "10-character PAN, e.g. ABCDE1234F" },
      { "type": "driving_license", "label": "Driving Licence", "flow": "instant", "hint": "Licence number and date of birth", "needsDob": true }
    ],
    "otpExpiryMinutes": 10,
    "mockMode": false
  }
}
```

`status` is one of `not_started`, `otp_sent`, `verified`, `needs_review`,
`failed`, `rejected`. `GET /users/kyc/config` returns just `config` (no auth).

### 2.2 Aadhaar

`POST /users/kyc/aadhaar/otp` with `{ "aadhaarNumber": "234567890124" }`
(spaces allowed):

```json
{ "status": "otp_sent", "maskedNumber": "XXXXXXXX0124", "expiresInSeconds": 600, "mockOtp": "123456" }
```

`POST /users/kyc/aadhaar/verify` with `{ "otp": "123456" }` returns the same
shape as `status` above (without `config`). `status` is `verified` or
`needs_review`.

- Wrong OTP → 422 `Incorrect OTP`. The request stays open, so let the rider retype.
- Expired OTP → 400, `details.code = "KYC_OTP_EXPIRED"`. Go back to the number step.

### 2.3 PAN / driving licence / voter ID

`POST /users/kyc/document`

```json
{ "documentType": "driving_license", "number": "MH0120190012345", "dob": "1990-01-31" }
```

`dob` is `YYYY-MM-DD`, only for `driving_license`. Returns the status shape.

### 2.4 Errors to handle

| HTTP | `details.code` | Meaning / UI |
|---|---|---|
| 400 | – | Bad number format; show `message` under the field |
| 400 | `KYC_OTP_EXPIRED` | Back to the number step |
| 409 | – | Already verified / under review; reload status |
| 422 | `KYC_VERIFICATION_FAILED` | Provider said no; show `message`, allow retry |
| 429 | `KYC_ATTEMPTS_EXCEEDED` (or rate limit) | Too many tries; show `message`, disable submit |
| 503 | `KYC_PROVIDER_UNAVAILABLE` | QuickeKYC down; "Try again in a minute" |

---

## 3. Booking gate (`KYC_REQUIRED`)

`POST /rides` (and parcel / intercity / rental bookings) can now fail with:

```json
{
  "success": false,
  "message": "Please verify your identity to book this ride.",
  "details": { "code": "KYC_REQUIRED", "kycStatus": "not_started" }
}
```

HTTP status is **403**. Make sure the app's 403 handler does **not** treat
this as "logged out". Only log the user out for the existing
deactivated/deleted-account messages.

```dart
on DioException catch (e) {
  final data = e.response?.data;
  if (data is Map && data['details']?['code'] == 'KYC_REQUIRED') {
    final verified = await Navigator.pushNamed(context, Routes.verifyIdentity,
        arguments: const VerifyIdentityArgs(returnToBooking: true));
    if (verified == true) retryBooking(); // or pop back to the booking screen
    return;
  }
  rethrow;
}
```

If `kycStatus == "needs_review"` the message already says it's under review.
Show it and don't open the form.

Optional nicety: call `GET /users/kyc/status` when the booking screen opens,
and show a "Verify to book" banner before the rider gets to the button. Use
the `requiredFor` rules in §1 together with the `serviceType` being booked.

---

## 4. Models

```dart
class KycDocumentOption {
  final String type, label, flow, hint;
  final bool needsDob;
  bool get isOtp => flow == 'otp';
  KycDocumentOption.fromJson(Map<String, dynamic> j)
      : type = j['type'],
        label = j['label'] ?? j['type'],
        flow = j['flow'] ?? 'instant',
        hint = j['hint'] ?? '',
        needsDob = j['needsDob'] == true;
}

class KycConfig {
  final bool enabled, mockMode;
  final String requiredFor;
  final int otpExpiryMinutes;
  final List<KycDocumentOption> documents;
  KycConfig.fromJson(Map<String, dynamic> j)
      : enabled = j['enabled'] == true,
        mockMode = j['mockMode'] == true,
        requiredFor = j['requiredFor'] ?? 'optional',
        otpExpiryMinutes = (j['otpExpiryMinutes'] ?? 10) as int,
        documents = ((j['documents'] ?? []) as List)
            .map((d) => KycDocumentOption.fromJson(d))
            .toList();

  bool requiredFor(String serviceType) => enabled &&
      switch (requiredFor) {
        'before_booking' || 'after_signup' => true,
        'rental_outstation' => serviceType == 'hourly_rental' || serviceType == 'intercity',
        _ => false,
      };
}

class KycStatus {
  final String status, documentType, documentLabel, maskedNumber, verifiedName, failureReason;
  final DateTime? verifiedAt;
  final KycConfig? config;
  bool get isVerified => status == 'verified';
  bool get underReview => status == 'needs_review';
  KycStatus.fromJson(Map<String, dynamic> j)
      : status = j['status'] ?? 'not_started',
        documentType = j['documentType'] ?? '',
        documentLabel = j['documentLabel'] ?? '',
        maskedNumber = j['maskedNumber'] ?? '',
        verifiedName = j['verifiedName'] ?? '',
        failureReason = j['failureReason'] ?? '',
        verifiedAt = j['verifiedAt'] != null ? DateTime.tryParse(j['verifiedAt']) : null,
        config = j['config'] is Map ? KycConfig.fromJson(j['config']) : null;
}
```

```dart
class KycApi {
  KycApi(this.dio);
  final Dio dio;
  Map<String, dynamic> _data(Response r) => (r.data['data'] as Map).cast();

  Future<KycStatus> status() async =>
      KycStatus.fromJson(_data(await dio.get('/users/kyc/status')));
  Future<Map<String, dynamic>> sendAadhaarOtp(String aadhaar) async =>
      _data(await dio.post('/users/kyc/aadhaar/otp', data: {'aadhaarNumber': aadhaar}));
  Future<KycStatus> verifyAadhaarOtp(String otp) async =>
      KycStatus.fromJson(_data(await dio.post('/users/kyc/aadhaar/verify', data: {'otp': otp})));
  Future<KycStatus> verifyDocument(String type, String number, {String? dob}) async =>
      KycStatus.fromJson(_data(await dio.post('/users/kyc/document',
          data: {'documentType': type, 'number': number, if (dob != null) 'dob': dob})));
}
```

---

## 5. Screens

### 5.1 `VerifyIdentityScreen`

Load `status()` and pick the state to show:

1. **Verified**: green badge, "You're verified", `documentLabel maskedNumber · verifiedName`.
   If opened from a booking (`returnToBooking`), show **Continue booking**,
   which pops with `true`.
2. **Under review** (`needs_review`): clock icon, "We've received your
   document. You can book once it's approved." No form.
3. **Not enabled** (`config.enabled == false`): "No verification needed".
4. **Form** (everything else):
   - Intro line. If `status` is `failed` or `rejected`, show a red note with `failureReason`.
   - **Choose a document**: 2-column chips from `config.documents`
     (label + "OTP verification" / "Instant"). First one selected.
     Lock the chips while an OTP is pending.
   - **Number field**: Aadhaar uses a numeric keyboard and formats as
     `XXXX XXXX XXXX` (send it without spaces). Others are uppercase text.
     Put `hint` under the field.
   - **DOB picker** when `needsDob`.
   - **Aadhaar step 2**: once `sendAadhaarOtp` returns, show an OTP field
     (autofill `oneTimeCode`), *"Sent to the mobile linked with Aadhaar
     XXXXXXXX0124"*, the `mockOtp` hint if present, a
     **Change number / resend OTP** link, and a countdown from
     `expiresInSeconds`.
   - **Submit button**: "Send OTP", then "Verify OTP" (Aadhaar) or "Verify"
     (others). Disabled while busy or while required fields are empty.
   - Errors go in a red box above the button (§2.4).

Validate locally before calling the API to save attempts:
Aadhaar is `^[2-9][0-9]{11}$` (the server also runs the Verhoeff
checksum), PAN `^[A-Z]{5}[0-9]{4}[A-Z]$`, Voter `^[A-Z]{3}[0-9]{7}$`,
DL `^[A-Z]{2}[0-9]{2}[0-9A-Z]{9,14}$`.

### 5.2 Profile

Add a **Verify Identity** row under Personal. Show it only when
`config.enabled` or the rider is already verified. Subtitle:
- `Verified · Aadhaar XXXXXXXX0124`
- `Under review`
- `Not verified yet`

### 5.3 After signup

On the home screen's first build after login: if `config.enabled &&
config.requiredFor == 'after_signup'` and the status isn't `verified` or
`needs_review`, push `VerifyIdentityScreen` once per app session (keep a
flag in memory). The rider can go back; the server still blocks bookings.

---

## 6. Admin (web only, for reference)

- **Settings → Third-party Settings → User Verification (KYC):** on/off,
  when required, accepted documents, name-mismatch rule, attempt limit, OTP
  expiry, and QuickeKYC credentials and endpoint paths.
- **Users list:** KYC column and filter.
- **User profile → KYC tab:** details, attempt log, and Approve / Reject / Reset.

---

## 7. Test checklist (mock mode)

- [ ] KYC off: no profile row, bookings work.
- [ ] `before_booking`: booking → `KYC_REQUIRED` → KYC screen → verify →
      Continue booking → booking succeeds. User is **not** logged out.
- [ ] Aadhaar: valid number → OTP step shows `mockOtp`; wrong OTP shows the
      error and keeps the OTP step; `123456` → verified (or "under review"
      if the profile name isn't "Test User").
- [ ] PAN `ABCDE1234F` → verified instantly; `ABCD1234F` → format error, no API call.
- [ ] Driving licence without DOB → button disabled.
- [ ] `rental_outstation`: city ride books without KYC; hourly rental is blocked.
- [ ] `after_signup`: fresh login opens the KYC screen once.
- [ ] Admin Reject → app shows the rejection reason and allows a retry.
