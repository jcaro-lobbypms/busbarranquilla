# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

**MiBus** (mibus.co) is a collaborative real-time public transport app for Barranquilla and the Metropolitan Area (Colombia). Users report bus locations in real time — the passenger IS the GPS. The system uses a credit economy to incentivize participation and offers premium subscription plans (Wompi payments).

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express 5 + TypeScript |
| Database | PostgreSQL 15 + Redis 7 |
| Real-time | Socket.io 4 |
| Auth | JWT (30-day expiry) + bcryptjs (salt 10) |
| Web frontend | React + Vite + TailwindCSS + Leaflet |
| Mobile | React Native 0.81 + Expo 54 (early stage) |
| Payments | Wompi (Colombian payments) |
| Notifications | Firebase Cloud Messaging (upcoming) |

## Running the project

**The project runs via Docker. Do not use `npm run dev` directly** — PostgreSQL and Redis only exist as containers.

```bash
docker-compose up --build   # First run or after Dockerfile changes
docker-compose up           # Normal start
docker-compose down         # Stop everything
docker-compose logs -f backend
docker-compose logs -f web
```

| Service  | Port | Description |
|----------|------|-------------|
| backend  | 3000 | Node.js API |
| web      | 5173 | React + Vite frontend |
| postgres | 5432 | PostgreSQL |
| redis    | 6379 | Cache / pub-sub |

Environment variables are defined in `docker-compose.yml` (not in `.env` files).

## Commands

### Backend (`backend/`)
```bash
npm run dev    # nodemon + ts-node (hot reload)
npm run build  # tsc → ./dist
npm start      # runs ./dist/index.js
```

### Web (`web/`)
```bash
npm run dev    # Vite dev server on :5173
npm run build  # Production build → ./dist
npm run preview
```

### Mobile (`mobile/`)
```bash
npm start         # Expo dev server
npm run android
npm run ios
npm run web
```

---

## Architecture

### Backend (`backend/src/`)

**Entry point** — `index.ts` creates the Express app, wraps it in an HTTP server for Socket.io, registers CORS + JSON middleware, mounts all route groups, initializes DB + schema, then starts listening.

**Route groups** (all prefixed `/api/`):
- `auth` → register, login, profile
- `routes` → bus route CRUD + search + nearby + active feed + trip planner (geometry-based) + geometry
- `stops` → stops per route (CRUD)
- `reports` → create report, list nearby (geolocation), confirm, resolve
- `credits` → balance, history, spend
- `trips` → start trip, update location, end trip, current trip
- `users` → favorites (add, remove, list)
- `payments` → Wompi plans, checkout, webhook
- `admin` → users CRUD + companies CRUD (requires `role = 'admin'`)

**Middleware chain for protected routes:**
- Public: no middleware
- Authenticated: `authMiddleware` (JWT → attaches `req.userId` + `req.userRole`)
- Admin only: `authMiddleware` + `requireRole('admin')` (from `middlewares/roleMiddleware.ts`)

**DB init** — `config/database.ts` holds the pg Pool; `config/schema.ts` runs `CREATE TABLE IF NOT EXISTS` on startup, then runs safe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations for new fields, then auto-seeds routes if the routes table is empty.

**Credit flow** — creating or confirming a report triggers `credit_transactions` via `awardCredits()` in `creditController.ts`. Premium users skip credit checks.

**Reports** expire in 30 minutes (`expires_at`). `/api/reports/nearby` filters by radius using Haversine formula. Reports can be self-resolved via `PATCH /api/reports/:id/resolve` (sets `is_active = false`, `resolved_at = NOW()`).

**Route geometry** — stored as JSONB in `routes.geometry` as `[lat, lng][]`. On create/update, the backend calls OSRM (two-attempt strategy: full route first, then segment-by-segment with straight-line fallback). Geometry can be regenerated on demand via `POST /api/routes/:id/regenerate-geometry`. The `pg` library auto-parses JSONB to `[number, number][]` — no manual JSON.parse needed in frontend. 78 routes have geometry covering lat 10.83–11.04, lng -74.89–-74.76.

**Trip planner (`/api/routes/plan`)** — geometry-based matching, not stop-based. Uses `haversineKm()` and `minDistToGeometry()` helpers. A route matches if its polyline passes within `ORIGIN_THRESHOLD_KM = 0.25` (250 m) of origin AND within `DEST_THRESHOLD_KM = 1.0` (1 km) of destination, with dest index > origin index (direction check). Fallback to stop-based (0.8 km radius) for routes without geometry. Results sorted by `origin_distance_meters + distance_meters`.

**Socket.io** — configured in `config/socket.ts`. Real-time bus location tracking via `bus:location`, `bus:joined`, `bus:left`, `route:nearby` channels. Route-specific rooms (`route:{id}`) for real-time report events: clients emit `join:route` / `leave:route` when boarding/alighting, server emits `route:new_report` and `route:report_confirmed` to the room.

**Seed** — `scripts/seedRoutes.ts` auto-runs on startup if `routes` table is empty. Seeds real Barranquilla bus routes with stops.

**Note**: In all route files, named routes (`/nearby`, `/search`, `/balance`, `/active-feed`, `/plan`, `/current`) must stay above param routes (`/:id`) to avoid Express conflicts.

#### Backend file map

```
backend/src/
├── index.ts
├── config/
│   ├── database.ts          # pg Pool
│   ├── schema.ts            # CREATE TABLE + migrations + auto-seed
│   └── socket.ts            # Socket.io setup
├── services/
│   ├── blogScraper.ts       # scanBlog(onProgress, {skipManuallyEdited}) — scrapes WordPress blog
│   ├── routeProcessor.ts    # processImports(onProgress, {skipManuallyEdited}) — geocodes + OSRM
│   ├── osrmService.ts       # fetchOSRMGeometry(stops) — 2-attempt OSRM strategy
│   └── legService.ts        # computeLegsForRoute — post-geometry leg computation
├── controllers/
│   ├── adminController.ts       # Users CRUD + Companies CRUD + scanBlog + processImports (with skipManuallyEdited)
│   ├── authController.ts        # register, login, profile
│   ├── creditController.ts      # balance, history, spend, awardCredits()
│   ├── paymentController.ts     # Wompi: getPlans, createCheckout, handleWebhook
│   ├── recommendController.ts   # Route recommendations
│   ├── reportController.ts      # create, nearby, confirm, resolveReport
│   ├── routeController.ts       # CRUD + search + nearby + activeFeed + getPlanRoutes + regenerateGeometry + getRouteActivity + snapWaypoints
│   ├── routeUpdateController.ts # reportRouteUpdate, getRouteUpdateAlerts (incl. geometry+reporters+GPS), getRouteUpdateAlertsCount, dismissRouteAlert
│   ├── stopController.ts        # CRUD per route
│   ├── tripController.ts        # start, updateLocation, end, active buses, getTripCurrent
│   └── userController.ts        # listFavorites, addFavorite, removeFavorite
├── middlewares/
│   ├── authMiddleware.ts    # JWT verify → req.userId, req.userRole
│   ├── creditMiddleware.ts  # Credit check for premium features
│   └── roleMiddleware.ts    # requireRole(...roles) factory
├── routes/
│   ├── adminRoutes.ts
│   ├── authRoutes.ts
│   ├── creditRoutes.ts
│   ├── paymentRoutes.ts     # GET /plans, POST /checkout, POST /webhook
│   ├── reportRoutes.ts
│   ├── routeRoutes.ts
│   ├── stopRoutes.ts
│   ├── tripRoutes.ts
│   └── userRoutes.ts        # /api/users/favorites
└── scripts/
    └── seedRoutes.ts        # Barranquilla routes + stops seed data
```

#### New API endpoints (added in Phase 3.8)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/routes/snap-waypoints` | admin | Takes `{waypoints: [lat,lng][]}`, calls OSRM, returns road-snapped `{geometry, hadFallbacks}` |

#### New API endpoints (added in Phase 3.7)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/routes/:id/activity` | ✅ | Route activity last hour: `active_count`, `last_activity_minutes`, `events[]`, `active_positions[]` |
| POST | `/api/routes/:id/update-report` | ✅ | User votes `trancon` or `ruta_real` on a route (upsert, one vote per user per route) |
| GET | `/api/routes/update-alerts` | admin | Routes with ≥3 `ruta_real` votes — includes `geometry`, `reporters[]`, `reporter_positions[]` |
| GET | `/api/routes/update-alerts/count` | admin | Count of unreviewed route update alerts (for sidebar badge) |
| PATCH | `/api/routes/:id/dismiss-alert` | admin | Mark alert as reviewed (`route_alert_reviewed_at = NOW()`) |

#### New API endpoints (added in Phase 3.5)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/reports/route/:routeId` | ✅ | Active reports for a route with `confirmed_by_me`, `is_valid`, `needed_confirmations` — only returns reports from other users |

#### New API endpoints (added in Phase 3 — Wompi payments)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/payments/plans` | public | Returns available plans (currently only `monthly` — $4,900 COP/30 days) |
| POST | `/api/payments/checkout` | ✅ | Creates Wompi payment link, saves pending payment, returns `checkout_url` |
| POST | `/api/payments/webhook` | public | Wompi webhook: verifies SHA256 signature, on APPROVED → sets `is_premium=true`, `role='premium'`, extends `premium_expires_at`, awards +50 bonus credits |

#### New API endpoints (added in Phase 2)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/routes/active-feed` | ✅ | Up to 8 routes with reports in last 60 min |
| GET | `/api/routes/plan?originLat=X&originLng=Y&destLat=X&destLng=Y` | ✅ | Geometry-based trip planner: routes whose polyline passes ≤250 m of origin and ≤1000 m of dest (direction-aware). Origin optional. |
| POST | `/api/routes/:id/regenerate-geometry` | admin | Re-fetch OSRM geometry for a route |
| GET | `/api/trips/current` | ✅ | Active trip for current user (`{ trip: null }` if none) |
| PATCH | `/api/reports/:id/resolve` | ✅ | Self-resolve own report |
| GET | `/api/users/favorites` | ✅ | List favorite routes |
| POST | `/api/users/favorites` | ✅ | Add route to favorites `{ route_id }` |
| DELETE | `/api/users/favorites/:routeId` | ✅ | Remove route from favorites |

---

### Web (`web/src/`)

**Routing** — `App.tsx` uses React Router v6 with two nested route groups:
- **Public layout** (`PublicLayout`) — renders `<Navbar />` + `<Outlet />`. Covers `/`, `/map`, `/login`, `/register`, `/premium`, `/payment/result`.
- **Admin layout** (`AdminRoute` guard + `AdminLayout`) — no Navbar, shows sidebar instead. Covers `/admin/*`.

**Auth state** — `context/AuthContext.tsx` stores JWT in `localStorage`, attaches via axios interceptor in `services/api.ts`. Exposes `user` (with `role: 'admin' | 'premium' | 'free'`), `token`, `loading`, `login`, `register`, `logout`, `refreshProfile`.

**API proxy** — Vite proxies `/api/*` → backend. Uses `BACKEND_URL` env var in Docker (`http://backend:3000`), `http://localhost:3000` locally.

**Admin panel** — accessible only to `role === 'admin'` users. `Navbar` shows "⚙️ Administración" link for admins. Redirects non-admins to `/map`, unauthenticated to `/login`.

#### Web file map

```
web/src/
├── App.tsx                        # Routes: PublicLayout + AdminRoute guard
├── context/
│   └── AuthContext.tsx            # Auth state + JWT + role
├── services/
│   ├── api.ts                     # axios instance + all API modules (incl. paymentsApi)
│   ├── adminService.ts            # Admin-specific API (users + companies)
│   └── socket.ts                  # Socket.io client
├── components/
│   ├── AdminRoute.tsx             # Layout route guard (role check → Outlet)
│   ├── CatchBusMode.tsx           # "Me subí/bajé" flow + 4 background monitors + activity display in waiting view
│   ├── CreditBalance.tsx
│   ├── MapView.tsx                # Leaflet map: stops, feed routes, active trip geometry + CenterTracker + bus icon on trip + activity positions
│   ├── Navbar.tsx                 # Shows ⚙️ Admin for admin, ⚡ Premium link for non-premium
│   ├── NearbyRoutes.tsx
│   ├── PlanTripMode.tsx           # Trip planner: Nominatim geocoding + /plan endpoint + activity panel in results
│   ├── ReportButton.tsx           # Has ✕ close button
│   ├── RoutePlanner.tsx
│   └── TripPanel.tsx
└── pages/
    ├── Home.tsx
    ├── Login.tsx
    ├── Map.tsx                    # Main map page: wires all modes + geometry state + map pick overlay + routeActivityPositions
    ├── PaymentResultPage.tsx      # Handles Wompi redirect: ?status=APPROVED|DECLINED
    ├── PremiumPage.tsx            # Plan listing + Wompi checkout redirect
    ├── Register.tsx
    └── admin/
        ├── AdminLayout.tsx        # Sidebar (gray-900) + Outlet — NO Navbar + alert badge polling
        ├── AdminRouteAlerts.tsx   # Route update alerts: ≥3 ruta_real votes → regenerar/dismiss
        ├── AdminRoutes.tsx        # Bus routes CRUD + geometry editor + Regenerar
        ├── AdminUsers.tsx         # Users table + role/active/delete actions
        └── AdminCompanies.tsx     # Companies table + CRUD + routes viewer
```

#### CatchBusMode — "Cerca de ti" section

Above the filter tabs and search, CatchBusMode shows a **horizontal scroll of nearby route cards** fetched from `/api/routes/nearby?lat=X&lng=Y&radius=0.3` (300 m) when `userPosition` is available.

- Cards show: route name (where the bus goes), company name (secondary, gray), code badge, distance in meters
- Tap → same `handleSelectRoute` flow as selecting from the main list (goes to waiting view)
- Skeleton loading placeholders while fetching
- Section hidden if no nearby routes returned

#### CatchBusMode — 4 background monitors

Active while a trip is running (`view === 'active'`). All monitors start on trip begin and are cleared on trip end.

| Monitor | Interval | Trigger | Action |
|---------|----------|---------|--------|
| 1 — Auto-resolve trancón | 120 s | Bus moved > 200 m from report location | `PATCH /api/reports/:id/resolve`, clear ref |
| 2 — Desvío detection | 30 s | Off all route stops > 250 m for ≥ 90 s | Banner with 3 options: report, get off, ignore 5 min |
| 3 — Auto-cierre inactividad | 60 s | Movement < 50 m for ≥ 600 s | Modal "¿Sigues en el bus?"; auto-close after 120 s |
| 4 — Alertas de bajada | 15 s | Destination set; premium/admin auto-activate, free pays 5 cr | Prepare (400 m), Now (200 m + vibrate), Missed banners |

#### `api.ts` modules

| Export | Endpoints |
|--------|-----------|
| `authApi` | register, login, getProfile |
| `routesApi` | list, getById, search, nearby, create, update, delete, recommend, activeFeed, plan, regenerateGeometry, getActivity, toggleActive, snapWaypoints, scanBlog(skipManuallyEdited), processImports(skipManuallyEdited) |
| `routeAlertsApi` | getAlerts, getAlertsCount, dismissAlert |
| `stopsApi` | listByRoute, add, delete, deleteByRoute |
| `adminApi` | getCompanies |
| `reportsApi` | getNearby, create, confirm, resolve, getOccupancy, getRouteReports |
| `creditsApi` | getBalance, getHistory, spend |
| `tripsApi` | getActive, getCurrent, getActiveBuses, start, updateLocation, end |
| `usersApi` | getFavorites, addFavorite, removeFavorite |
| `paymentsApi` | getPlans, createCheckout |

#### Admin panel routes

| Path | Component | Description |
|------|-----------|-------------|
| `/admin` | — | Redirects to `/admin/users` |
| `/admin/users` | `AdminUsers` | Users table: change role, toggle active, delete |
| `/admin/routes` | `AdminRoutes` | Bus routes CRUD + waypoint geometry editor (OSRM road-snap) + import mode toggle |
| `/admin/companies` | `AdminCompanies` | Companies CRUD + view associated routes |
| `/admin/route-alerts` | `AdminRouteAlerts` | Routes flagged by ≥3 users — mini-map (current geometry + reporter GPS), reporters table, actions |

#### Admin API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/users?role=X` | List users (optional role filter) |
| GET | `/api/admin/users/:id` | Get user by ID |
| PATCH | `/api/admin/users/:id/role` | Change user role |
| PATCH | `/api/admin/users/:id/toggle-active` | Toggle user active state |
| DELETE | `/api/admin/users/:id` | Delete user |
| GET | `/api/admin/companies` | List companies |
| GET | `/api/admin/companies/:id` | Get company + its routes |
| POST | `/api/admin/companies` | Create company |
| PUT | `/api/admin/companies/:id` | Update company |
| PATCH | `/api/admin/companies/:id/toggle-active` | Toggle company active state |
| DELETE | `/api/admin/companies/:id` | Delete company (fails 400 if has active routes) |

#### `adminService.ts` exports

Types: `AdminUser`, `UserRole`, `Company`, `CompanyRoute`, `CompanyInput`

Functions: `getUsers`, `updateUserRole`, `toggleUserActive`, `deleteUser`, `getCompanies`, `getCompanyById`, `createCompany`, `updateCompany`, `toggleCompanyActive`, `deleteCompany`

---

## Database Schema

### users
`id, name, email, password, phone, credits (default 50), is_premium, trial_expires_at, premium_expires_at, reputation, created_at`
**Migrations added:** `role VARCHAR(20) DEFAULT 'free' CHECK (role IN ('admin','premium','free'))`, `is_active BOOLEAN DEFAULT TRUE`

### companies
`id, name, nit, phone, email, is_active (default true), created_at`

### routes
`id, name, code (UNIQUE), company, first_departure, last_departure, frequency_minutes, is_active, created_at`
**Migrations added:** `company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`, `geometry JSONB DEFAULT NULL`, `route_alert_reviewed_at TIMESTAMPTZ DEFAULT NULL`, `manually_edited_at TIMESTAMPTZ DEFAULT NULL`

`manually_edited_at` is set to `NOW()` when admin edits a route via `PUT /api/routes/:id`. Cleared to `NULL` when `POST /api/routes/:id/regenerate-geometry` runs. Used by import system to skip manually-edited routes.

### route_update_reports
`id, route_id (→ routes CASCADE), user_id (→ users CASCADE), tipo VARCHAR(20) CHECK ('trancon'|'ruta_real'), created_at` — `UNIQUE(route_id, user_id)`
User votes that the bus route has changed or is stuck. ≥3 `ruta_real` votes trigger an admin alert.

### stops
`id, route_id, name, latitude, longitude, stop_order, created_at`

### reports
`id, user_id, route_id, type, latitude, longitude, description, is_active, confirmations, created_at, expires_at (NOW() + 30 min)`
**Migrations added:** `report_lat DECIMAL(10,8)`, `report_lng DECIMAL(11,8)`, `resolved_at TIMESTAMPTZ DEFAULT NULL`, `credits_awarded_to_reporter BOOLEAN DEFAULT FALSE`

### report_confirmations
`id, report_id (→ reports), user_id (→ users), created_at` — `UNIQUE(report_id, user_id)`

### credit_transactions
`id, user_id, amount, type, description, created_at`

### active_trips
`id, user_id, route_id, current_latitude, current_longitude, destination_stop_id, started_at, last_location_at, ended_at, credits_earned, is_active`

### user_favorite_routes
`id, user_id (→ users), route_id (→ routes), created_at` — `UNIQUE(user_id, route_id)`

### payments
`id, user_id (→ users ON DELETE SET NULL), wompi_reference VARCHAR(100) UNIQUE, plan VARCHAR(50), amount_cents INTEGER, status VARCHAR(20) DEFAULT 'pending' CHECK (pending|approved|declined|voided|error), wompi_transaction_id VARCHAR(100), created_at, updated_at`

---

## WebSocket Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `bus:location` | server → all | Transmits active bus locations |
| `bus:joined` | server → all | User boarded a bus |
| `bus:left` | server → all | User got off a bus |
| `route:nearby` | server → all | Nearby routes for a location |
| `join:route` | client → server | Join route room when trip starts |
| `leave:route` | client → server | Leave route room when trip ends |
| `route:new_report` | server → room | New report created on the route |
| `route:report_confirmed` | server → room | Report confirmation count updated |

---

## Main App Flow (Core UX)

### 1. Open the app
- Show user's current location on the map (GPS)
- Show nearby routes within 500 meters
- Show active buses reported by other users in real time

### 2. Trip planner
- User types destination (or picks on map via crosshair overlay + Confirm button)
- Start point = current GPS location, or typed address
- Geocoding: **Nominatim** (primary, `bounded=1`, strict BQ metro bbox) + **Geoapify** fallback. Handles Colombian addresses with "N" separator (e.g. "Cr 52 N 45" → "Cr 52 #45"). Post-fetch filter `isInMetroArea()` removes results outside BQ area. Overpass API for street intersections.
- Before entering destination: **"Buses en tu zona"** panel shows routes ≤300 m from origin — tap any to preview full geometry on map; tapping again deselects
- App finds routes connecting origin → destination via `/api/routes/plan` (geometry-based, not stop-based)
- Shows multiple options ordered by `origin_distance + dest_distance`; distances color-coded (green ≤300 m, amber 300–600 m, red >600 m)
- Selecting a result clips the route geometry between boarding stop and dropoff stop and draws it on the map (blue polyline); fallback to full geometry, then all stops
- Map pick mode: fixed crosshair at screen center, instruction banner, Confirm + Cancel buttons overlay — `BottomSheet` hidden via CSS `display:none` (not unmounted) to preserve input state

### 3. "I boarded" flow
- User taps "Me subí" (I boarded)
- Selects which route/bus it is
- Optionally sets drop-off stop
- Phone transmits bus location in real time via WebSocket
- Other users see the bus moving on the map
- User earns +1 credit per minute transmitting
- 4 background monitors activate (see CatchBusMode section)

### 4. "I got off" flow
- User taps "Me bajé" (I got off)
- Stops transmitting location
- Shows trip summary with credits earned
- Option to rate the trip

### 5. Drop-off alerts (Monitor 4)
- Auto-activated for premium/admin; costs 5 credits for free users
- Prepare banner at 400 m from destination
- "Bájate ya" alert + vibration at 200 m
- Missed alert if bus passes destination

---

## Business Rules

- New users get **50 credits** and a **14-day premium trial** on registration.
- Reports expire after **30 minutes**.
- Premium users skip all credit checks.
- Premium plan: **$4,900 COP/month** (Wompi payment link, single-use, manual renewal). On approval: `is_premium=true`, `role='premium'`, `premium_expires_at` extended 30 days, +50 bonus credits. Webhook verified via SHA256 signature.
- Credit packages: 100/$1,900 | 300/$4,900 | 700/$9,900 | 1,500/$17,900 COP.

### Credits earned
| Action | Credits | Notes |
|--------|---------|-------|
| Report (outside active trip) | +3–5 | Immediate, per `CREDITS_BY_TYPE` |
| Report during trip, alone on bus | +1 | Immediate |
| Report during trip, others on bus | 0 → +2 | +2 when report reaches 50%+ confirmations; +1 auto on trip end if no confirmation |
| Confirm another user's report | +1 | Max 3 per trip; confirmer must have active trip on same route |
| Report no service | +4 | |
| Invite a friend | +25 | |
| 7-day reporting streak | +30 | |
| Welcome bonus (registration) | +50 | |
| Per minute transmitting bus location | +1 | |
| Complete full trip | +10 | |

**Occupancy report rules:**
- Only two states: `lleno` (🔴 Bus lleno) and `bus_disponible` (🟢 Hay sillas)
- Per occupancy type, only the first report per trip earns credits (tracked via `occupancyCreditedRef` in frontend + `credit_transactions` check in backend)
- 10-minute cooldown between occupancy reports on the same route

### Credits spent
| Feature | Cost | Notes |
|---------|------|-------|
| Stop drop-off alert | 5 | Auto-free for premium/admin; free users pay per trip |

---

## Development Phases

### Phase 1 ✅ Complete
- Express + TypeScript + Docker
- Auth with 14-day premium trial + role system (admin / premium / free)
- Routes, stops, reports, credits modules
- React web with map
- Auto-seed of Barranquilla real bus routes

### Phase 2 ✅ Complete
**Admin panel:**
- Role-based access control (`requireRole` middleware + `AdminRoute` guard)
- Admin layout with sidebar (no Navbar)
- `/admin/users` — full users table with role change, toggle active, delete
- `/admin/routes` — bus routes CRUD + geometry editor (drag points, Regenerar per row)
- `/admin/companies` — companies CRUD with routes viewer
- Navbar link "⚙️ Administración" visible only to admins

**Real-time user flow:**
- GPS location on map + nearby routes via active-feed endpoint
- Trip planner (`PlanTripMode`) — Nominatim + Overpass autocomplete + `/api/routes/plan`
- "Me subí / Me bajé" flow (`CatchBusMode`) — full state machine
- 4 background monitors: auto-resolve trancón, desvío detection, auto-cierre, drop-off alerts
- Favorites system (`/api/users/favorites` — add, remove, list)
- Self-resolve reports (`PATCH /api/reports/:id/resolve`)
- Route geometry via OSRM (2-attempt: full route → segment-by-segment + straight-line fallback)
- Geometry displayed on map: green polyline for active trip, blue for feed route selection

### Phase 2.5 ✅ Complete
**"Cerca de ti" in CatchBusMode:**
- Horizontal scroll of route cards above the filter/search, auto-fetched from `/api/routes/nearby` when GPS available
- Cards show: route name → company name → code badge → distance in meters
- Tap → direct boarding flow (same as selecting from list)

**"Buses en tu zona" in PlanTripMode:**
- Vertical list of routes ≤500 m from origin, shown before destination is entered
- Updates automatically when origin changes (GPS or typed address)
- Tap → previews route geometry on map immediately (uses `geometry` from `/nearby` response; fallback to stops fetch if null)
- Mini info bar: "¿Va a tu destino? Escríbelo arriba ↑" + ✕ to clear
- Race condition guard: `previewRouteIdRef` ensures stale async results never overwrite a newer selection
- Section disappears once plan results are shown

**Map geometry fixes:**
- "← Volver" in `Map.tsx` trip mode now clears `activeTripGeometry` + `catchBusBoardingStop`
- Route clipping in `handleSelectRoute` falls back to full geometry (then all stops) if segment indices are invalid
- Removed "Cómo llegar a pie" (Google Maps external link) from waiting view

### Phase 3 ✅ Complete
- Deploy to Vercel + Railway
- Connect mibus.co domain (Vercel → mibus.co, Railway → api.mibus.co)
- Wompi payments — `paymentController.ts`, `paymentRoutes.ts`, `PremiumPage.tsx`, `PaymentResultPage.tsx`
  - `GET /api/payments/plans` — returns monthly plan ($4,900 COP)
  - `POST /api/payments/checkout` — creates Wompi payment link (single-use)
  - `POST /api/payments/webhook` — SHA256 signature verification → activates premium + +50 credits bonus
- `payments` table in DB tracks all transactions with status
- Navbar shows "⚡ Premium" link for non-premium users; "✓ Premium" badge for active premium

### Phase 3.5 ✅ Complete
**Smart report confirmation system:**
- Removed `casi_lleno` — occupancy is now binary: `lleno` / `bus_disponible` (both worth +3 outside trips)
- Deferred credit system for trip reports: +1 if alone, 0 if others present (waits for confirmations)
- Confirmation system: confirmer earns +1 (max 3/trip), reporter earns +2 when 50%+ of other passengers confirm
- Report validity: `activeUsers <= 1` → always valid; `activeUsers >= 2` → needs `ceil((activeUsers-1) × 0.5)` confirmations
- Auto-award: reporter gets +1 on trip end for any report that never got confirmed
- Real-time via Socket.io rooms (`route:{id}`): new reports and confirmations appear instantly to all passengers on the same bus
- New table: `report_confirmations` — prevents double confirmation per user per report
- New column: `reports.credits_awarded_to_reporter` — prevents double payment to reporter

### Phase 3.6 ✅ Complete
**Geocoding & UX improvements:**
- Replaced Photon (no Spanish support) with **Nominatim** primary + **Geoapify** fallback for address autocomplete
- Colombian address normalization: `N` separator (e.g. "Cr 52 N 45" → "Cr 52 #45"); flexible Overpass regex for street queries
- Post-fetch `isInMetroArea()` filter + Nominatim `bounded=1` + strict bbox `[10.82,-74.98,11.08,-74.62]` — no results outside BQ metro
- Postal code detection (`isPostalCode()`) — filters out 080xxx codes from suggestions
- Map pick mode redesigned: fixed crosshair at screen center, instruction banner, Confirm + Cancel buttons; `BottomSheet` uses CSS `display:none` to preserve state while picking
- Nearby radius reduced 500 m → **300 m** in both CatchBusMode and PlanTripMode
- Distance color-coding in plan results: green ≤300 m, amber 300–600 m, red >600 m + "(lejos)"
- ReportButton now has ✕ close button
- `MapView.tsx`: added `CenterTracker` component (tracks map center on `moveend`/`zoomend` via `useMapEvents`)

**Geometry-based trip planner (backend rewrite):**
- `getPlanRoutes` completely rewritten — searches by route geometry proximity, not stop proximity
- `haversineKm()` and `minDistToGeometry()` helpers in `routeController.ts`
- `ORIGIN_THRESHOLD_KM = 0.25` (250 m), `DEST_THRESHOLD_KM = 0.45` (450 m)
- Direction check: destination must appear after origin index along the polyline
- Fallback to stop-based (0.8 km) for routes without geometry
- Fixes "999 m boarding distance" issue — origin distance now always ≤ 250 m for geometry-matched routes

**Docker:**
- `web/Dockerfile.dev` — Node.js 20 Alpine, runs `npm run dev` (replaces nginx multi-stage that caused `npm: not found`)
- `docker-compose.yml` uses `dockerfile: Dockerfile.dev` for web service

### Phase 3.7 ✅ Complete

**Trip planner destination threshold:**
- `DEST_THRESHOLD_KM` raised from `0.45` → `1.0` (1 km) — catches routes that drop off nearby but not right at the destination (e.g. D8 Lolaya at 618 m)

**Bus icon on active trip:**
- `MapView.tsx`: user location marker changes to a green pulsing 🚌 icon (`USER_ON_BUS_ICON`) when the user has an active trip (`activeTripGeometry` is set)
- `ACTIVITY_BUS_ICON` (amber pulsing 🚌) rendered for each active position from `routeActivityPositions` prop — shows other active buses on the selected route

**Route activity feature — "¿Hay actividad en esta ruta?"**
- New backend endpoint `GET /api/routes/:id/activity` (auth): queries `active_trips` + `reports` from last hour, returns:
  - `active_count` — users currently on this route
  - `last_activity_minutes` — minutes since last boarding/alighting/report (null if >60 min)
  - `events[]` — boarding, alighting and report events with timestamps and confirmations
  - `active_positions[]` — `[lat, lng]` of currently active trips for map rendering
- `routesApi.getActivity(id)` added to `api.ts`
- **PlanTripMode**: activity fetched on `handleSelectRoute` and `handleNearbyPreview`; shown as collapsible panel in plan result cards and inline in "Buses en tu zona" selected card
- **CatchBusMode**: activity fetched on `handleSelectRoute`; shown as summary card in the waiting view (between route info and boarding stop)
- **MapView**: `routeActivityPositions` prop renders amber 🚌 markers for active trips on the previewed route
- **Map.tsx**: `routeActivityPositions` state wires PlanTripMode → MapView

**Route update alert system:**
- Passengers can flag a route as `trancon` (stuck in traffic) or `ruta_real` (real route differs from map)
- New table `route_update_reports` — one vote per user per route (upsert)
- When ≥3 users flag `ruta_real` in 30 days → admin alert is triggered
- New admin page `/admin/route-alerts` (`AdminRouteAlerts.tsx`) — shows alert cards, two actions per route: "Regenerar geometría y marcar revisada" or "Marcar como revisada"
- `AdminLayout.tsx` sidebar shows red badge with unreviewed count (polls every 60 s)
- `routeAlertsApi` added to `api.ts`: `getAlerts`, `getAlertsCount`, `dismissAlert`
- New DB column `routes.route_alert_reviewed_at` tracks when admin last reviewed

### Phase 3.8 ✅ Complete

**Waypoint geometry editor with road snapping:**
- New endpoint `POST /api/routes/snap-waypoints` (admin): receives `{waypoints: [lat,lng][]}`, calls OSRM, returns full road-snapped geometry
- `routesApi.snapWaypoints(waypoints)` added to `api.ts`
- AdminRoutes.tsx geometry editor completely reworked:
  - "✏️ Editar trazado por calles" extracts ~12 evenly-spaced orange waypoint markers from existing geometry
  - Drag any waypoint → calls snap endpoint → polyline updates following real streets
  - Click on empty map → adds new waypoint at that position + snaps
  - Click on waypoint → removes it + snaps (min 2 waypoints)
  - "⏳ Calculando ruta por calles…" indicator while OSRM responds
  - "🔄 Resetear a OSRM" re-extracts waypoints from the OSRM geometry
- `snapAndUpdate(waypoints)` useCallback; fallback to raw waypoints if OSRM fails
- `waypointsRef` keeps waypoint state accessible inside Leaflet drag events

**AdminRouteAlerts visual comparison:**
- `getRouteUpdateAlerts` now returns per alert: `geometry` (current DB polyline), `reporters[]` ({user_name, tipo, created_at}), `reporter_positions[]` (last GPS of reporters in past 7 days)
- `AdminRouteAlerts.tsx` collapsible "Ver trazado y reportantes" panel per alert:
  - `RouteMapPreview` Leaflet sub-component: blue polyline = current DB route, red pulsing dots = reporter GPS positions, green/red dots = start/end markers, legend
  - Reporters table: name | tipo badge | relative time
- Actions: "Regenerar desde paradas" | "✏️ Editar trazado manualmente" → `/admin/routes` | "Ya revisé, marcar cerrada"

**Import protection (manually_edited_at):**
- New DB column `routes.manually_edited_at TIMESTAMPTZ` — set `NOW()` on `PUT /api/routes/:id`, cleared `NULL` on `regenerateGeometry`
- `blogScraper.ts`: `ScanOptions.skipManuallyEdited` — skips existing routes with `manually_edited_at IS NOT NULL`; `ScanResult` now includes `skipped` count
- `routeProcessor.ts`: `ProcessOptions.skipManuallyEdited` — skips pending routes with `manually_edited_at IS NOT NULL`; `ProcessResult` now includes `skipped` count
- `adminController.ts`: reads `skipManuallyEdited` from `req.body` and passes to both services
- `api.ts`: `scanBlog(skipManuallyEdited)`, `processImports(skipManuallyEdited)`
- `AdminRoutes.tsx`:
  - Toggle UI: **🔒 Solo nuevas** (default) / **🔄 Todas** — controls `importMode` state
  - Routes with `manually_edited_at` show `✏️ manual` amber badge in the table with tooltip date
  - Result messages show omitted count: "3 omitidas (editadas)"

### Phase 4 — Future
- React Native mobile app (early stage in `mobile/`)
- Firebase push notifications
- Google Play + App Store
- Alliance with AMB and SIBUS Barranquilla
