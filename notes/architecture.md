# LockedIn — Architecture & Design Notes

_Last updated: 2026-03-25_

---

## LinkedIn Automation — Browser-Driven Flow

### Core Design Decision
LinkedIn DMs are sent by controlling the user's **real logged-in browser** via AppleScript, not through any API. The flow is always:

1. Open the contact's full LinkedIn profile URL in the configured browser (Chrome by default).
2. Find and click the **Message** button on the profile page.
3. Wait for the compose overlay to appear (polling up to 5 s).
4. Focus the message input, type the message, click **Send**.

For **reminders**, the flow stops at step 2/3 — it opens the compose overlay and leaves it ready for the user to type manually.

This is the only reliable approach because LinkedIn has no public messaging API and actively guards against compose-URL tricks.

### Why Profile URL, Not Compose URL
Earlier iterations tried to navigate directly to `https://www.linkedin.com/messaging/compose/?to=<slug>`. This broke silently when:
- LinkedIn changed the compose URL format.
- The contact's slug didn't match their current URL.

Profile-page-first is more resilient: the Message button is always tied to the correct account regardless of slug drift.

---

## URL Normalization (`shared/linkedin.ts`)

All LinkedIn URL handling is centralized here. Never bypass these helpers.

| Function | Purpose |
|---|---|
| `extractLinkedInSlug(url)` | Extracts `/in/<slug>` from any LinkedIn URL, decodes percent-encoding |
| `normalizeLinkedInProfileUrl(url)` | Returns canonical `https://www.linkedin.com/in/<slug>/` or `''` |
| `isLinkedInProfileUrl(url)` | Boolean check |
| `areSameLinkedInProfileUrls(a, b)` | Compares two URLs after normalization (slug-safe) |
| `normalizeLinkedInRecipientText(value)` | Strips noise words / zero-width chars for fuzzy name matching |

**Source of truth:** the `linkedin_url` stored in the `contacts` table is always a normalized canonical URL. The `linkedin_slug` column is derived from it and kept in sync.

---

## LinkedIn DOM Selectors (`electron/services/linkedin.service.ts`)

All selectors are in `LINKEDIN_SELECTORS` const at the top of `linkedin.service.ts`. Update them there when LinkedIn changes markup:

```ts
PROFILE_ROOT:        'main'
MESSAGE_INPUT:       'div.msg-form__contenteditable'
SEND_BUTTON:         'button.msg-form__send-button'
OVERLAY_CONTAINER:   'section.msg-overlay-bubble, div.msg-overlay-bubble, aside.msg-overlay-bubble, section.msg-overlay-conversation-bubble, div.msg-overlay-conversation-bubble'
```

Run `tests/linkedin-selectors.test.ts` to verify selectors are still valid after any LinkedIn UI update.

### Failure Codes
Non-retryable (hard stop, no backoff):
- `permission_issue` — Accessibility not granted
- `login_wall` — user not logged in
- `rate_limited` — LinkedIn throttle

Retryable (backoff: 15 s → 45 s → 120 s):
- `stale_selectors`, `overlay_mismatch`, `send_confirmation_missing`, `unexpected`

---

## Scheduler (`electron/services/scheduler.service.ts`)

### Key Behaviors
- **In-memory jobs** via `node-schedule`. If the app quits, jobs are gone — must re-init on launch.
- **Sleep/wake resync:** `main.ts` listens to `powerMonitor` events and re-registers jobs after wake.
- **Missed recurring catch-up:** On init, compares `last_fired_at` against expected fire time. If the gap is within a tolerance window, fires immediately as `catch_up`.
- **Past-due one-time schedules:** Classified as `missed`, `recover`, or `consume` based on log history and retry count. `recover` fires immediately; `missed`/`consume` mark the schedule disabled.
- **Mutex (`executing` Set):** Prevents double-send if a job fires while a retry is still pending.
- **Retry backoff:** `[15_000, 45_000, 120_000]` ms. Non-retryable failures skip backoff entirely.

### Execution Context Labels
| Context | Meaning |
|---|---|
| `scheduled` | Normal cron/one-time fire |
| `catch_up` | Fired to recover a missed recurring run |
| `retry` | Automated retry after a transient failure |
| `manual_test` | Triggered by user via "Test Send" in UI |

---

## IPC Layer (`src/lib/ipc.ts`)

All renderer → main calls go through `createIpcApi()`, which wraps every call with a **10 s timeout**. Timeout message format: `IPC call "<name>" timed out after 10s — main process may be unresponsive`.

Events (`onScheduleExecuted`, `onReminderTriggered`) are pass-through — they return unsubscribe functions, not promises, so they are not wrapped.

The exported `api` object is frozen to prevent accidental mutation.

---

## UI Components Added

### `DatePickerPopover`
Custom calendar popover with inline month grid + time picker. Used in `ScheduleForm` for one-time schedule date/time selection. Does not depend on any third-party date picker library.

### `TimeRulerPicker`
Scrollable ruler for hour/minute selection — quarter-hour snapping (`00`, `15`, `30`, `45`). Used inside `DatePickerPopover`.

### `src/lib/schedule-picker.ts`
Pure utility library with no React imports. Handles:
- Calendar day cell generation
- 12-hour ↔ 24-hour conversion
- `formatLocalDateTimeValue()` for `<input type="datetime-local">`
- Meridiem toggling

---

## Settings (`src/pages/Settings.tsx`)

Settings are stored as key-value in the `settings` SQLite table (no `.env` files). All reads/writes go through `useSettings()` hook → IPC → `settings.ipc.ts`.

Validation errors are now shown inline (field-level) rather than as a toast. Settings page shows accessibility status and a direct "Open LinkedIn" shortcut.

---

## Testing

| Test file | Covers |
|---|---|
| `ipc-validation.test.ts` | Input validation for all IPC handlers |
| `ipc-wrapper.test.ts` | Timeout behavior, freeze, pass-through events |
| `linkedin-selectors.test.ts` | DOM selector strings + URL normalization |
| `reminder.logic.test.ts` | Reminder scheduling, snooze, next-reminder calculation |
| `scheduler.logic.test.ts` | Catch-up, retry backoff, mutex, past-due one-time logic |
| `schedule-picker.test.ts` | Calendar math, time formatting, meridiem conversion |
| `toast-contract.test.ts` | Toast variant contracts |

Run all: `npm run verify` (tests + both typechecks).

---

## Known Fragility

- LinkedIn DOM selectors can break any time LinkedIn ships a UI update. The `LINKEDIN_SELECTORS` const + tests make this recoverable quickly.
- Scheduler jobs are in-memory — the app must stay running. Sleep/wake resync covers normal Mac sleep but not force-quit.
- AppleScript requires **Accessibility permissions** (`System Settings > Privacy & Security > Accessibility`). Without them, every send fails with a non-retryable `permission_issue`.
