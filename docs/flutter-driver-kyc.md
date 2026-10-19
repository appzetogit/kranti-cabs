# Driver KYC (QuickeKYC) – Flutter implementation guide

Drivers can now verify their identity through QuickeKYC, under rules the admin
sets separately from riders. It's the same engine and the same QuickeKYC
account as rider KYC. See `flutter-user-kyc.md` for the shared parts:
document types, the error table, mock mode and the Dart models. The models
can be reused as they are.

Base URL: `https://kranticabs.com/api/v1`. All endpoints need the driver's
`Authorization: Bearer <token>`. They also work for drivers **still awaiting
approval**, because the admin may require KYC before approving them.

This is separate from the existing Recharge-API checks in onboarding
(DL / PAN / RC / bank / UPI). Those stay as they are.

---

## 1. Admin rules (`config.requiredFor`)

| Value | Effect in the driver app |
|---|---|
| `optional` | Nothing is blocked. Show "Verify Identity" in the profile |
| `before_approval` | The admin can't approve the driver until KYC is `verified`. Show KYC as an onboarding / status-screen step |
| `before_going_online` | `PATCH /drivers/online` returns `DRIVER_KYC_REQUIRED` until verified |

Default accepted documents for drivers are **Driving Licence** and
**Aadhaar**. The admin can change these. Always render from `config.documents`.

---

## 2. Endpoints

Same request and response shapes as the rider endpoints, under `/drivers`:

| Rider | Driver |
|---|---|
| `GET /users/kyc/status` | `GET /drivers/kyc/status` |
| `POST /users/kyc/aadhaar/otp` | `POST /drivers/kyc/aadhaar/otp` |
| `POST /users/kyc/aadhaar/verify` | `POST /drivers/kyc/aadhaar/verify` |
| `POST /users/kyc/document` | `POST /drivers/kyc/document` |

`GET /drivers/kyc/status` returns `{ status, isVerified, documentType,
documentLabel, maskedNumber, verifiedName, verifiedAt, failureReason,
underReview, config: { enabled, requiredFor, documents[], otpExpiryMinutes,
mockMode } }`.

Driving licence needs `dob` (`YYYY-MM-DD`):

```json
POST /drivers/kyc/document
{ "documentType": "driving_license", "number": "MH0120190012345", "dob": "1988-04-12" }
```

Reuse `KycApi` from the rider guide with a base path:

```dart
class KycApi {
  KycApi(this.dio, {this.basePath = '/users'});
  final Dio dio;
  final String basePath; // '/drivers' in the driver app
  Map<String, dynamic> _data(Response r) => (r.data['data'] as Map).cast();

  Future<KycStatus> status() async =>
      KycStatus.fromJson(_data(await dio.get('$basePath/kyc/status')));
  Future<Map<String, dynamic>> sendAadhaarOtp(String aadhaar) async =>
      _data(await dio.post('$basePath/kyc/aadhaar/otp', data: {'aadhaarNumber': aadhaar}));
  Future<KycStatus> verifyAadhaarOtp(String otp) async =>
      KycStatus.fromJson(_data(await dio.post('$basePath/kyc/aadhaar/verify', data: {'otp': otp})));
  Future<KycStatus> verifyDocument(String type, String number, {String? dob}) async =>
      KycStatus.fromJson(_data(await dio.post('$basePath/kyc/document',
          data: {'documentType': type, 'number': number, if (dob != null) 'dob': dob})));
}

final driverKyc = KycApi(dio, basePath: '/drivers');
```

`KycConfig.requiredFor(serviceType)` from the rider guide is rider-only. For
drivers, compare `config.requiredFor` with the values in §1.

---

## 3. Go-online gate

`PATCH /drivers/online` can now fail **before** the selfie check with:

```json
{
  "success": false,
  "message": "Please verify your identity before going online.",
  "details": { "code": "DRIVER_KYC_REQUIRED", "kycStatus": "not_started" }
}
```

HTTP **403**. Don't treat it as a logout, and don't open the selfie camera.

```dart
on DioException catch (e) {
  final data = e.response?.data;
  if (data is Map && data['details']?['code'] == 'DRIVER_KYC_REQUIRED') {
    showStatus(data['message']);
    if (data['details']['kycStatus'] != 'needs_review') {
      final ok = await Navigator.pushNamed(context, Routes.driverKyc,
          arguments: const VerifyIdentityArgs(returnToOnline: true));
      if (ok == true) goOnline(); // retry
    }
    return;
  }
  rethrow;
}
```

If `kycStatus == 'needs_review'`, show the message ("…under review. You can go
online once it is approved.") and stay on the home screen.

Nice to have: load `GET /drivers/kyc/status` on the home screen. When the rule
is `before_going_online` and the driver isn't verified, swap the Go Online
button for a **Verify identity to go online** button, so the 403 rarely
happens.

---

## 4. Approval gate (`before_approval`)

Nothing to handle in API errors, because the block is on the admin side. The
driver app's job is to **get the driver to verify while pending**:

- On the registration status / "under review" screen, call
  `GET /drivers/kyc/status`. If `config.enabled && config.requiredFor ==
  'before_approval' && status != 'verified'`, show a card above the checklist:
  - `not_started` / `failed` / `rejected`: **Action needed – Verify your
    identity**. "Your application can be approved once you verify with
    Aadhaar, your driving licence or another accepted ID." Add a
    **Verify now** button that opens the KYC screen. Show `failureReason`
    when present.
  - `needs_review`: **Identity verification under review**, with no button.
- Optionally add the same step to the onboarding stepper after documents.
- KYC routes must be reachable while the driver is pending. Don't put them
  behind the "approved driver" guard.

When an admin tries to approve an unverified driver, the web admin shows
*"This driver has not completed identity verification yet."*

---

## 5. Screens

### 5.1 `DriverVerifyIdentityScreen`

Use the same screen as riders (`flutter-user-kyc.md` §5.1) with
`KycApi(basePath: '/drivers')` and driver copy:

- Intro: "Verify your identity to drive with us. We store only the last four
  digits of your document."
- From the go-online gate: "Verify your identity to start taking rides."
- Verified + `returnToOnline`: button **Back to go online**, which pops with `true`.
- Under review: "…you can continue once it is approved."

### 5.2 Profile

Under "Your Account", above Documents, add **Verify Identity**. Show it only
when `config.enabled` or the driver is already verified. Subtitle:
`Verified · Driving Licence XXXXXXXXXXX2345`, `Under review` or
`Not verified yet`. Don't add it for fleet owners.

---

## 6. Admin (web only, for reference)

- **Settings → Third-party Settings → Identity Verification (KYC):** a
  **Drivers** tab with its own on/off switch, rule, accepted documents,
  name-mismatch rule and limits. The QuickeKYC connection is shared with riders.
- **Drivers → Pending:** a KYC badge per driver, linking to their KYC tab.
- **Driver details → KYC tab:** details, attempt log, and Approve / Reject / Reset.

Duplicate detection is per account type. A person may use the same Aadhaar as
a rider and as a driver, but not for two driver accounts.

---

## 7. Test checklist (mock mode: any valid number, Aadhaar OTP `123456`)

- [ ] Driver KYC off: no profile row, go online works, admin approval works.
- [ ] `before_approval`: pending driver sees the card → verifies DL → card
      disappears. Admin approve works only after.
- [ ] `before_going_online`: approved, unverified driver taps Go Online →
      KYC screen (no selfie prompt) → verify → Back to go online → online.
- [ ] Driving licence: Verify button is disabled until DOB is set.
- [ ] Name on document ≠ profile name → "Under review". Go online is blocked
      with the review message, and the KYC screen does not open.
- [ ] Admin Reset → driver can verify again.
- [ ] Rider KYC settings are unaffected by driver changes, and the reverse.
