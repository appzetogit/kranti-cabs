# Driver app – wallet credit limit (negative balance) – Flutter implementation guide

The driver wallet can now go **below zero**. On a cash ride the driver collects the
whole fare, and the platform's commission is taken from their wallet. A driver can
keep taking rides until they owe up to the admin's **credit limit**, which is
**₹500 live** today. After that they must top up.

Base URL: `https://kranticabs.com/api/v1`. Every call needs
`Authorization: Bearer <driver access token>`.

> **Already in the app:**
> - Commit `27f2119`: negative balance display and the wallet notice.
> - Commit `4a08559`: accept handling.
>
> Both are in `kranti_cabs_flutterproject/kranticabs_driver` and **not compiled
> yet**. Another session is still working on the wallet (labels for what's owed,
> the withdrawal rule, notifications). Check `git log` for anything newer than
> this guide.

---

## 1. How it works on the server
| | |
|---|---|
| **Credit limit** | Admin → Wallet Settings → "minimum wallet balance to get an order". A **negative** value is a credit limit: `-500` lets a driver owe up to ₹500 |
| **Cash ride** | Commission (+ the rider's platform fee) is **taken from** the wallet at trip end. No commission on station entry fee, state / MCD tax or parking. A covering daily pass waives the commission part |
| **Online-paid ride** | The driver's earnings are **added to** the wallet, which reduces what they owe |
| **Top-up** | Adds to the wallet |
| **Offers** | A cash ride whose commission would take the wallet past the limit is **not offered** to that driver |
| **Accept** | Checked again at accept, which refuses it with `WALLET_LIMIT_FOR_RIDE` |
| **Past the limit** | No rides, and going online is refused, until they top up (`WALLET_BELOW_LIMIT`) |
| **Withdrawals** | Can never exceed the balance, so a driver who owes money can't withdraw |

---

## 2. Reading the wallet
```
GET /drivers/wallet
```
```json
{
  "success": true,
  "data": {
    "wallet": {
      "balance": -120,
      "cashLimit": 500,
      "minimumBalanceForOrders": -500,
      "availableForOrders": 380,
      "isWalletEnabled": true,
      "isTransferEnabled": true,
      "minimumTopUpAmount": 500,
      "minimumTransferAmount": 100,
      "isBlocked": false
    },
    "transactions": [ … ],
    "withdrawalRequests": [ … ]
  }
}
```
| Field | Meaning |
|---|---|
| `balance` | Can be **negative**. -120 means the driver owes ₹120 |
| `minimumBalanceForOrders` | The limit. `-500` = may owe up to ₹500. A positive value (e.g. 100) means they must *keep* that much |
| `cashLimit` | The same limit as a positive number (500), or 0 when the minimum is positive |
| `availableForOrders` | `balance − minimumBalanceForOrders`: how much more commission they can take on |
| `isBlocked` | No rides until they top up |

Worked out in the app (already in `WalletData`, `wallet_model.dart`):
```dart
double get owed => balance < 0 ? -balance : 0;                       // 120
double get creditLimit => minimumBalanceForOrders < 0 ? -minimumBalanceForOrders : 0;  // 500
double get topUpToGetRides {                                          // 0 while rides are allowed
  final gap = minimumBalanceForOrders - balance;
  return gap > 0 ? gap.ceilToDouble() : 0;
}
String formatSignedRupees(double a) => a < 0 ? '-₹${a.abs().toStringAsFixed(0)}' : '₹${a.toStringAsFixed(0)}';
```

---

## 3. Showing it
- **Balance:** always **`-₹120`**, never `₹-120`, and in **red** when negative. This
  applies to the wallet screen, the withdraw screen and the home-screen wallet tile.
- **Notice under the balance**, when the driver owes or is blocked:
  - **Owes, not blocked:** "You owe ₹120 commission from cash rides. Rides continue
    until you owe ₹500 - top up to clear it."
  - **Blocked:** "Top up ₹100 to get rides again" (use `topUpToGetRides`)
- **Withdraw:** with a balance of 0 or less, don't let them start a withdrawal. The
  server refuses it anyway ("Withdrawal amount cannot exceed current balance").

---

## 4. Refusals and their codes
The server words these messages for the driver. **Show `message` as-is.** The
amounts are already in it.

| Where | HTTP | `code` | Example `message` |
|---|---|---|---|
| Going online (`PATCH /drivers/online`) or accept | 403 | `WALLET_BELOW_LIMIT` | "Top up ₹100 to get rides again. Your wallet is -₹600 and the limit is -₹500." |
| Accept of one cash ride | 403 | `WALLET_LIMIT_FOR_RIDE` | "Top up ₹50 to take this ride. Its ₹100 commission would take your wallet below -₹500." |
| Same, with daily passes on and waiving the minimum | 403 | `WALLET_PASS_REQUIRED` | "Buy today's pass to go online and get rides." |
| Admin turned the driver wallet off | 403 | `WALLET_DISABLED` | "Driver wallet is disabled by admin." |

**Where the code is:**
- **REST:** in `details` (`{ "success": false, "message": "…", "details": { "code": "WALLET_LIMIT_FOR_RIDE", "topUpAmount": 50, "commission": 100, "balance": -450, "limit": -500 } }`).
- **Socket:** the `errorMessage` event carries `{ message, code }`.

**What the app does:**
- **Socket accept:** `WALLET_*` codes **close the offer card** and show the message,
  because the ride can't be taken without a top-up. This is in `ride_providers.dart`.
- **Native offer card** (REST accept): a 403 means the ride wasn't taken. The app's
  follow-up accept gets the same code and closes the card.
- **Going online:** show the message with an **Add Money** button that opens the
  wallet top-up.

Rides that would break the limit are usually **not offered at all**, so the accept
refusal is rare. It's a safety net for offers already on screen when the balance
dropped.

---

## 5. Test checklist
Admin: Wallet Settings → minimum `-500`. Commission 10% for the test vehicle.

- [ ] Balance 571: shows ₹571, no notice
- [ ] Do cash rides until the balance is -120: shows **-₹120** in red, with "You owe ₹120 … until you owe ₹500"
- [ ] Balance -450: a ₹1000 cash ride (₹100 commission) is not offered; an online-paid ride is
- [ ] Balance -450, accept a ₹1000 cash offer that was already showing: the card closes with "Top up ₹50 to take this ride…"
- [ ] Balance -600: going online is refused with "Top up ₹100 to get rides again…"; the wallet notice says the same
- [ ] Top up ₹200 from -600: the balance is -400, and going online works
- [ ] Withdraw with a negative balance: not allowed
