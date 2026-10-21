# Zone-wise promo banners – Flutter implementation guide

Admins can now aim each home-screen promo banner at one app (rider, driver
or both) and at zero or more zones. A banner with no zones shows everywhere.
Both Flutter apps need to send the person's location when they fetch
banners, and the driver app gets a new banner strip.

Base URL: `https://kranticabs.com/api/v1`. Neither banner endpoint needs a
token, but sending one does no harm.

---

## 1. How it works

| Admin sets | Who sees the banner |
|---|---|
| Show in **Rider & driver apps**, no zones | Everyone, everywhere (old banners behave like this) |
| Show in **Rider app only**, zone *Indore* | Riders whose location is inside the Indore zone |
| Show in **Driver app only**, zone *India* | Drivers anywhere inside the India zone, including inside city zones within it |

- Zones nest. Production has one nationwide **India** zone with city zones
  inside it, so a point in Indore is in both *India* and *Indore*. A banner
  aimed at either one shows there.
- If the location is outside every zone, or no location is sent, only the
  all-zone banners come back. Old app builds that send nothing therefore keep
  seeing exactly what they saw before.
- Banners aimed at the person's zone come first, then the all-zone ones,
  newest first within each group.

---

## 2. API

All responses look like `{ "success": true, "data": { ... } }`. Errors look
like `{ "success": false, "message": "...", "details": { "code": "..." } }`.

### 2.1 Rider app

`GET /users/banners?lat=22.7533&lng=75.8937`

### 2.2 Driver app (new)

`GET /drivers/banners?lat=22.7533&lng=75.8937`

This always returns driver banners; an `audience` parameter is ignored.

### 2.3 Query parameters

| Param | Notes |
|---|---|
| `lat`, `lng` | Send both, or neither. Two decimals (about 1 km) is enough |
| `zone_id` | Optional instead of `lat`/`lng`, if the app already knows the zone |
| `audience` | `/users/banners` only: `rider` (default) or `driver` |

### 2.4 Response

```json
{
  "results": [
    {
      "_id": "6716...",
      "image": "https://kranticabs.com/uploads/banner-....jpg",
      "active": true,
      "title": "Indore riders: 20% off",
      "link_type": "external_link",
      "redirect_url": "https://example.com/offer",
      "audience": "rider"
    }
  ],
  "paginator": { "current_page": 1, "per_page": 50, "total": 1, "last_page": 1 },
  "audience": "rider",
  "zones": [{ "_id": "66f1...", "name": "India" }, { "_id": "66f2...", "name": "Indore" }],
  "any_banners": true
}
```

- `image` can be a full URL or a path like `uploads/x.jpg`. Prefix a path
  with `https://kranticabs.com/`.
- `title` is empty when the admin didn't give one. Don't show a fallback
  heading built from the date.
- `redirect_url`: `https://…` opens in the browser; a value starting with `/`
  is an in-app route (`link_type: "deep_link"`). Empty means not tappable.
- `zones` lists every zone containing the location. It's for debugging and
  analytics; don't show it.
- `any_banners` is `false` when the admin has no active banners for this app
  at all. If the app has its own placeholder promos, show them only in that
  case. When it's `true` and `results` is empty, there's simply nothing for
  this zone: hide the carousel.

### 2.5 Errors

| HTTP | `details.code` | When |
|---|---|---|
| 400 | `INVALID_LOCATION` | Only one of `lat`/`lng`, non-numbers, or out of range |
| 400 | `INVALID_ZONE` | `zone_id` isn't a valid id |
| 400 | `INVALID_BANNER_AUDIENCE` | `audience` isn't `rider` or `driver` |

Banners are decoration. On any error, keep the last banners you had (or
none) and never show an error to the person.

### 2.6 The old `userHomeSettings.promos` copy

The general settings still carry `userHomeSettings.promos`, a copy of the
banners kept as a fallback. It now holds **only** all-zone banners that
riders can see. If the rider app reads banners from there today, switch it
to `/users/banners`; otherwise zone-targeted banners never appear.

---

## 3. Rider app

1. Fetch `/users/banners` when the home screen opens, using the location the
   app already shows in the pickup bar: the GPS fix if there is one,
   otherwise the last saved location. With neither, call it without
   `lat`/`lng`.
2. Fetch again when the pickup location changes by roughly a kilometre (the
   two-decimal value changes) and every 10 minutes while the home screen is
   visible. Don't fetch on every GPS update.
3. Render the existing home carousel from `results`. Hide it when `results`
   is empty (see `any_banners` above for placeholders).
4. On tap: open `redirect_url` as described in 2.4.

```dart
class BannerApi {
  BannerApi(this.dio);
  final Dio dio;

  Future<BannerFeed> fetch(String path, {double? lat, double? lng}) async {
    final res = await dio.get(path, queryParameters: {
      if (lat != null && lng != null) ...{
        'lat': lat.toStringAsFixed(2),
        'lng': lng.toStringAsFixed(2),
      },
    });
    return BannerFeed.fromJson(res.data['data'] as Map<String, dynamic>);
  }
}

class BannerFeed {
  BannerFeed({required this.banners, required this.anyBanners});
  final List<PromoBanner> banners;
  final bool anyBanners;

  factory BannerFeed.fromJson(Map<String, dynamic> json) => BannerFeed(
        banners: (json['results'] as List? ?? [])
            .map((e) => PromoBanner.fromJson(e as Map<String, dynamic>))
            .toList(),
        anyBanners: json['any_banners'] == true,
      );
}

class PromoBanner {
  PromoBanner({required this.id, required this.image, required this.title, required this.redirectUrl});
  final String id, image, title, redirectUrl;

  factory PromoBanner.fromJson(Map<String, dynamic> json) => PromoBanner(
        id: json['_id'] as String? ?? '',
        image: json['image'] as String? ?? '',
        title: json['title'] as String? ?? '',
        redirectUrl: json['redirect_url'] as String? ?? '',
      );

  String imageUrl(String origin) =>
      image.startsWith('http') ? image : '$origin/${image.replaceFirst(RegExp(r'^/+'), '')}';
}
```

Rider: `bannerApi.fetch('/users/banners', lat: pickup.lat, lng: pickup.lng)`.

---

## 4. Driver app

New: a slim banner strip on the driver home screen. The web driver app
already has it; match its behaviour.

- **Where:** in the bottom stack above the "Today's Summary" card (below the
  surge card when that shows). Full width, 84 px high, rounded 16, image
  `BoxFit.cover`.
- **Data:** `bannerApi.fetch('/drivers/banners', lat: pos.lat, lng: pos.lng)`
  with the driver's current GPS position, falling back to the last known
  position. Show it whether the driver is online or offline. Same refetch
  rules as the rider app.
- **Several banners:** rotate every 4 seconds, with small dots at the
  bottom.
- **Hide button:** a small × in the top-right corner hides the strip until
  the app is restarted, so it never competes with the map while driving.
- **Tap:** open `redirect_url` as described in 2.4.
- **Empty or error:** don't render the strip at all.

---

## 5. Admin (web only, for reference)

**Promotions → Banner Image.** The list shows each banner's app ("Rider",
"Driver" or "Rider & Driver") and zones ("All zones" or zone names; a deleted
zone shows in red). The new edit button and the create form have:

- Title (optional)
- **Show in:** Rider & driver apps / Rider app only / Driver app only
- **Zones:** pick any number; none selected = all zones

---

## 6. Test checklist

Set up: one all-zone banner, one rider banner for *Indore*, one driver
banner for *India*, one banner for *New Delhi* shown in both apps.

- [ ] Rider in Indore sees the Indore banner first, then the all-zone one.
      No driver banner, no Delhi banner.
- [ ] Rider moves the pickup to New Delhi: carousel switches to Delhi + all-zone.
- [ ] Rider with location off and nothing saved sees only the all-zone banner.
- [ ] Driver in Indore sees the India driver banner + the all-zone one.
- [ ] Driver strip: rotates, × hides it until restart, tap opens the link.
- [ ] Admin turns off every rider banner: rider carousel is hidden (or shows
      the app's placeholders, since `any_banners` is `false`).
- [ ] Server unreachable: no error shown, previous banners stay.
