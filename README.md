# AI Life Planner

A personal productivity app that combines a weekly planner, a monthly calendar, a daily view, weather forecasts and a cost-efficient AI planning assistant. It's built for a university student who also works (ZeMA), and runs on laptops, tablets and phones as an installable PWA.

- **Dashboard**: weekly weather forecast, today's schedule, upcoming meetings and deadlines, today's priorities, data-driven recommendations, and a weekly overview.
- **Weekly planner**: seven clickable weather cards (tap a day for hourly details), Monday–Sunday columns with each day's forecast, drag-and-drop (mouse, touch long-press, keyboard), inline add, an unscheduled tray, week navigation, and recurring tasks.
- **Monthly calendar**: month, week, day and agenda views with weather icons where a forecast exists. Drag to move, resize to change duration, tap a date to open its daily schedule, colour-coded categories, and deadline markers.
- **Daily view** (`/today`, `/day?date=…`): detailed weather with an hourly strip, an hourly timeline with free slots highlighted, classes, meetings, tasks, deadlines, available time, recommendations and **Plan my day**. Day / Week / Month switch in one tap; all three read the same data.
- **Weather** (Open-Meteo): current conditions, 16-day daily forecast, hourly forecast, rain warnings for outdoor activities and dry windows. Search a city, save it, or opt in to device location.
- **Tasks, Gym, Personal**: one list of every task with filters and search; focused pages for workouts (with outdoor weather) and personal life.
- **University**: semester timetable (enter a class once and it repeats weekly until the semester ends), subjects, assignments, exams, study sessions and lecture notes.
- **ZeMA Work**: meetings, projects (including SEO), deadlines, work schedule and completed work.
- **AI assistant**: a docked right-hand panel on wide screens (floating button on phones and tablets) and a full page. It's grounded in your real data, shows conflict alerts and recommendations, suggests best times with **Accept**, and runs **Plan my day** and **Review my week**. Every AI change is a proposal you **Accept** or **Reject**. Simple questions ("What is my next class?") are answered from the database without calling the AI.
- **Notifications**: in-app notification centre, browser notifications, and Web Push driven by a server-side cron.
- **Progress**: tasks completed and remaining, overdue assignments, upcoming deadlines, workload by category, and an 8-week trend, with a table view.
- **Sync**: one Postgres database for every device, automatic refresh, and optimistic concurrency so edits from two devices never silently overwrite each other. JSON and ICS export.

---

## Tech stack

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5.9 |
| Styling / UI | Tailwind CSS 4, shadcn/ui-style components on Radix (`radix-ui`), lucide icons, `next-themes` (light/dark) |
| Data | PostgreSQL + Prisma 6 |
| Auth | Email/password (bcrypt), database-backed sessions in an httpOnly cookie |
| Board DnD | `@dnd-kit/core` |
| Calendar | FullCalendar 6 (daygrid, timegrid, list, interaction) |
| Client data | TanStack Query (shared cache → board and calendar always agree) |
| AI | OpenAI **Responses API** (function calling, `store: false`), or any OpenAI-compatible Chat Completions endpoint, called server-side with `fetch` |
| Weather | Open-Meteo forecast + geocoding APIs (free for non-commercial use, no key), cached in Postgres |
| Push | Web Push (VAPID) via `web-push`, service worker in `public/sw.js` |
| Charts | Recharts |
| Tests | Vitest |

> Why Prisma 6 and FullCalendar 6? Prisma 7+/8 and FullCalendar 7 are newer major versions with breaking changes. This project deliberately uses the latest *proven* release lines for reliability.

---

## Quick start (local)

Requirements: **Node 20.9+**, and **PostgreSQL 14+** (or Docker).

```bash
# 1. Start Postgres (or use your own and adjust DATABASE_URL)
docker run -d --name lifeplanner-db -e POSTGRES_USER=planner -e POSTGRES_PASSWORD=planner \
  -e POSTGRES_DB=lifeplanner -p 5433:5432 postgres:17-alpine

# 2. Install and configure
npm install
cp .env.example .env          # then edit values (see below)
npm run vapid                 # optional: prints Web Push keys to paste into .env

# 3. Create the database schema
npx prisma migrate deploy     # or `npm run db:migrate` while developing

# 4. Run
npm run dev                   # http://localhost:3000
```

Open the app, **create your account**, and you're in. Six default categories are created for you (University, ZeMA Work, Gym, Personal, Meetings, Other).

> The service worker (offline support and push) is only registered in production builds. To try it locally, run `npm run build && npm start`.

### Environment variables

See [`.env.example`](.env.example) for the full template.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection used by the app (on Vercel, use your provider's **pooled** URL) |
| `DIRECT_URL` | ✅ | Direct (non-pooled) URL used by `prisma migrate`. Locally, set it to the same value as `DATABASE_URL` |
| `ALLOW_SIGNUP` | | Set to `false` after creating your account to close registration |
| `AI_PROVIDER` | | `openai` (default, Responses API) or `compatible` |
| `OPENAI_API_KEY` | for AI | OpenAI key. **Server-only**: it is never sent to the browser |
| `OPENAI_MODEL` | | Default model for every account (default `gpt-5-mini`). Users can override it in **AI Settings** |
| `OPENAI_REASONING_EFFORT` | | `low` (default) keeps hidden reasoning tokens small. `off` for models without reasoning |
| `OPENAI_BASE_URL` | | Override the OpenAI endpoint (default `https://api.openai.com/v1`) |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | | Only for `AI_PROVIDER=compatible` (OpenRouter, Groq, Ollama, LM Studio…) |
| `WEATHER_FORECAST_URL`, `WEATHER_GEOCODE_URL` | | Optional Open-Meteo overrides (self-hosted or commercial instance) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | for push | Web Push keys (`npm run vapid`) and a contact `mailto:` |
| `CRON_SECRET` | for reminders | Bearer token protecting `/api/cron/reminders` |

---

## Deploying to Vercel

1. **Create a Postgres database.** Neon, Supabase, Vercel Postgres or any hosted Postgres works. Copy its *pooled* URL into `DATABASE_URL` and its *direct* URL into `DIRECT_URL`.
2. **Push this project to GitHub** and import it in Vercel.
3. **Add the environment variables** listed above in *Project → Settings → Environment Variables*. Generate a long random `CRON_SECRET` (e.g. `openssl rand -hex 32`).
4. **Deploy.** The `vercel-build` script runs `prisma generate && prisma migrate deploy && next build`, so migrations are applied automatically.
5. Visit the site and **create your account**. Then set `ALLOW_SIGNUP=false` and redeploy.

### Scheduled reminders (important)

Reminders are generated by `GET /api/cron/reminders` (authorised with `Authorization: Bearer $CRON_SECRET`). The job is idempotent, so it never sends duplicates.

- `vercel.json` registers a **daily** Vercel Cron (06:00 UTC). This is all Vercel's Hobby plan allows. It covers deadline, overdue and daily-plan notifications, but **not** "class in 15 minutes" reminders.
- For timely reminders, use one of these:
  - Vercel **Pro**: change the schedule in `vercel.json` to `*/5 * * * *`.
  - The included **GitHub Actions** workflow (`.github/workflows/reminders.yml`): add the repository secrets `APP_URL` and `CRON_SECRET`. It runs every 5 minutes, though GitHub can delay scheduled runs.
  - Any external scheduler (e.g. cron-job.org) calling the endpoint with the bearer token.
- While the app is open, it also checks for due reminders every minute, so in-app reminders work even without a cron.

### Other hosts

Any Node host works: `npm run build`, then `npm run start:prod` (applies migrations, then starts).

---

## Installing the app (PWA)

The app ships a web manifest, icons, and a service worker. Once installed, it opens in its own window without browser tabs or an address bar.

| Device | How |
|---|---|
| **iPhone / iPad** | Open in **Safari** → **Share** → **Add to Home Screen** → **Add** |
| **Android** | Open in **Chrome** → **⋮** menu → **Install app** / **Add to Home screen** |
| **Windows / macOS (Chrome, Edge)** | Click the **install icon** in the address bar, or **⋮** → **Install AI Life Planner** |
| **macOS Safari 17+** | **File** → **Add to Dock** |

The same instructions, tailored to the current device and with an **Install** button where the browser supports it, are in **Settings → Install app**.

**Offline:** the app shell and the schedule you last viewed are cached and readable offline. Creating and editing needs a connection, which keeps every device consistent. An "Offline" badge appears in the header when you're offline.

**Push notifications** can arrive while the app is closed only if *all* of the following are true: VAPID keys are configured, a cron runs the reminder job, and the browser supports Web Push. On iOS/iPadOS this requires **16.4+** and the app **installed to the Home Screen**. Enable push per device in **Settings → Notifications**.

---

## How the AI works (and stays safe)

- **The API key lives only in server environment variables.** It is never stored in the database, never sent to the browser, and never kept in browser storage. All model calls happen in API routes.
- **OpenAI Responses API** with function calling. Requests use `store: false`, a per-request `max_output_tokens` cap and `reasoning.effort: low`. Encrypted reasoning items are replayed between tool rounds, so nothing is kept on OpenAI's side.
- **Agent tools** (all scoped to the signed-in user, validated with zod): `get_tasks`, `get_calendar_events`, `find_available_slots`, `analyze_weekly_workload`, `get_weather_forecast`, and the write tools `create_task`, `update_task`, `reschedule_task`, `delete_task`. The model never sees database credentials.
- **Changes need your approval.** Write tools never touch the database: they validate the change and queue it in a proposal with a before/after preview and **Accept** / **Reject** (you can untick individual changes). On Accept, every action is re-validated and ownership is re-checked. Items edited on another device in the meantime are skipped, and a proposal can't be applied twice. Deleting a class, exam, meeting or urgent item is flagged and starts unticked. Deleting a repeating item only ever removes one occurrence.
- **Deterministic first.** Free-slot search, overlap detection, move warnings (conflicts, deadline risk, overloaded days, studying after the exam), weather warnings and day planning are ordinary code in `src/lib/scheduler.ts` and `src/lib/weather-advice.ts`, all unit-tested. `reschedule_task` checks overlaps itself and returns the conflict plus an alternative, so "Move my gym session to 4 PM" is answered correctly even by a small model. The model only chooses, orders and explains.
- **Weather is supporting information.** It comes only from Open-Meteo data (`get_weather_forecast`). Nothing is moved automatically because of weather, and dates beyond the forecast range are shown as "Forecast unavailable".
- **Prompt-injection defences.** Task text is passed as JSON *data*, the instructions tell the model to ignore instructions inside it, tool arguments are validated, and there are no external-network or bulk-destructive tools.

### Keeping AI costs low

| Measure | Where |
|---|---|
| Simple look-ups ("What is my next class?", "What meetings do I have tomorrow?") are answered from the database. **No AI call.** | `src/lib/ai/quick-answers.ts` |
| Overlaps, free slots, workload and weather warnings use ordinary code. Drag-and-drop never calls AI; risky moves offer an **Ask AI** button instead | `scheduler.ts`, `tasks.ts → computeInsights` |
| The chat gets a compact snapshot (today + 2 days, near deadlines), not your whole history. The model fetches more with tools only when needed | `api/ai/chat` |
| Identical questions, plans and reviews for an unchanged schedule reuse the stored answer (keyed by a hash of the exact input) | `src/lib/ai/cache.ts`, `AiCache` table |
| A stable prompt prefix and `prompt_cache_key` let OpenAI bill repeated input at the cached rate. Cached tokens are tracked and priced separately | `client.ts` |
| Loop limits: at most 5 model rounds and 10 tool calls per message, repeated identical tool calls are de-duplicated, and the request stops if the monthly budget is reached mid-way | `api/ai/chat` |
| Monthly spending limit, a confirmation prompt above a per-request estimate, and per-feature usage with token counts | **AI Settings** |

**Model choice (checked 2026-10-28).** The default is `gpt-5-mini` ($0.25 / $2.00 per 1M input / output tokens). The newer **`gpt-6-luna`** ($0.10 / $0.50) supports function calling and reasoning effort. In a live test of this app's agent (conflict-aware rescheduling, finding a 2-hour slot before a deadline, a weather question) it gave correct, concise answers at about **5× lower cost per question** (~$0.0003 vs ~$0.0014). To switch everyone, set `OPENAI_MODEL=gpt-6-luna`; to switch one account, use **AI Settings**, which also fills in the published prices. Prices change, so verify them on OpenAI's pricing page.

**Graceful fallback.** If AI is off, unconfigured, over budget or failing, slot suggestions, conflict fixes, Plan my day and Review my week still work using the rule-based scheduler, and the app says so.

---

## Weather

- **Provider:** [Open-Meteo](https://open-meteo.com/) — free for non-commercial use (≈10,000 calls/day), no API key, CC BY 4.0 attribution shown in the app. For commercial use, get an Open-Meteo API key and set `WEATHER_FORECAST_URL` / `WEATHER_GEOCODE_URL` to the customer endpoints.
- **Location:** search a city in **Settings → Weather** (or from the weekly planner), toggle °C/°F, or tap **Use my location**. The browser asks for permission only when you tap it, and coordinates are rounded to about 1 km. GPS is never required.
- **Caching:** forecasts are fetched server-side, shared between users at the same location, and refreshed at most every 30 minutes. If the provider is down, the last forecast (up to 48 h old) is shown and marked as such. Without one, the planner keeps working and simply says weather is unavailable.
- **Range:** 16 days ahead (plus the past 7 days, so the current week is complete). Later dates show "Forecast unavailable"; nothing is extrapolated.
- **Timezone:** forecasts are requested in your account's timezone, so days line up with your planner.

---

## Security

- bcrypt (cost 12) password hashing, with constant-time handling for unknown emails.
- Random 256-bit session tokens. Only their SHA-256 hash is stored, and the cookie is httpOnly, `SameSite=Lax`, and `Secure` in production. Signing out deletes the server session and cached offline data.
- Every API route checks the session and scopes every query by `userId`. Other users' records return 404.
- Origin check on state-changing requests (CSRF defence in addition to SameSite).
- zod validation on every input (strict objects: unknown fields are rejected).
- Postgres-backed rate limiting (works across serverless instances) on login, signup, AI, uploads and exports.
- Optimistic concurrency (`version`) prevents lost updates between devices (HTTP 409 → the client reloads the latest version).
- Attachments (≤ 4 MB, allow-listed types) are always served as downloads with `nosniff`.
- Security headers (HSTS, frame-deny, nosniff, referrer and permissions policies).
- Destructive actions (deleting tasks, series, categories, subjects, semesters) always ask for confirmation.

---

## Project structure

```
prisma/
  schema.prisma            data model (users, sessions, tasks, categories, university, notifications, AI usage/proposals…)
  migrations/              SQL migrations
public/
  sw.js                    service worker (offline cache + push)
  icons/                   PWA icons (regenerate: npm run icons)
src/
  proxy.ts                 redirects signed-out visitors (Next 16 "proxy", formerly middleware)
  app/
    (auth)/login, signup   auth pages
    (app)/                 authenticated pages: dashboard, week, calendar, day, today, tasks, university, work, gym, personal, assistant, progress, settings, settings/ai
    api/                   route handlers (tasks, categories, university, settings, notifications, push, cron, ai/*, weather, export, stats)
    manifest.ts            web app manifest
  components/              UI (week board, calendar, task dialog, AI chat/proposals/plan/review, settings…)
    ui/                    shadcn/ui-style primitives
  hooks/use-planner.ts     shared React Query hooks + optimistic updates
  lib/
    scheduler.ts           free slots, conflicts, move evaluation, day planner (pure, tested)
    recurrence.ts          recurring series expansion (pure, tested)
    dates.ts               local date/time + timezone helpers
    tasks.ts               task service: range queries, occurrences, concurrency, insights
    ai/                    Responses API client (cost/budget), context, tools, proposals, quick answers, answer cache, model prices
    weather.ts             Open-Meteo client, cache, geocoding
    weather-advice.ts      rain warnings for outdoor plans, dry windows (pure, tested)
    notifications.ts, push.ts, auth.ts, rate-limit.ts, validation.ts, stats.ts
tests/                     Vitest unit tests
```

### Data model notes

- Dates and times are stored as local wall-clock strings (`YYYY-MM-DD`, `HH:mm`) plus the user's IANA timezone. A planner reasons in wall-clock time, so the same schedule looks identical on every device. Reminders convert to absolute instants using the timezone.
- A recurring series is one row with a recurrence rule. Occurrences are expanded on read, with ids like `taskId@2026-11-02`. Editing, completing or moving one occurrence "detaches" it into its own row and adds the date to the series' exclusions. Editing the series changes every occurrence.
- Semester classes are weekly series whose `until` follows the semester end date. Change the end date and every class follows.

---

## Testing

```bash
npm test            # unit tests (scheduler, recurrence, timezones, validation, Responses API parsing, quick answers, weather)
npm run typecheck   # TypeScript
npm run build       # production build
```

---

## Known limitations

- Push notifications while the app is closed depend on platform support and a frequently-running cron (see above). They can't be guaranteed on every device or browser.
- Offline mode is read-only by design. There is no offline edit queue, which avoids sync conflicts.
- Attachments are stored in Postgres (≤ 4 MB each). For heavy use, move them to object storage (e.g. Vercel Blob or S3).
- AI cost figures are estimates. Your provider's billing dashboard is the source of truth.
- The chat conversation is kept per browser tab (sessionStorage). Your schedule and every accepted change are in the database, but the chat transcript doesn't sync between devices.
- Outdoor activities are detected from the **Outdoor activity** switch on a task, or guessed from words like "run", "hike" or "park". Turn the switch on for anything else outdoors.
- The backup export (JSON / ICS) is download-only. There is no import screen yet.
# Daily-_planer
# Daily-_planer
