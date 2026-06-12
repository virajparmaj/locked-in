# LockedIn — Architecture & Design Notes

_Last updated: 2026-06-11_

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

## AppleScript Utilities (`electron/utils/applescript.ts`)

| Export | Purpose |
|---|---|
| `runAppleScript(script, timeoutMs?)` | Execute AppleScript via `osascript`. Returns stdout, throws on failure. Safety-kills process at `timeoutMs + 1000` ms. |
| `runCommand(command, args, timeoutMs?)` | Execute a shell command (e.g., `open` for URL schemes). |
| `toAppleScriptString(value)` | Escapes and quotes a string for safe AppleScript interpolation. |
| `toAppleScriptNumber(value)` | Validates that a value is a pure digit string and returns it unquoted for AppleScript integer comparisons. Throws if non-numeric. |
| `classifyAppleScriptError(rawMessage)` | Converts osascript stderr into user-friendly permission errors. Detects Accessibility denial, Automation denial, and Chrome's "JavaScript through AppleScript is turned off" (View > Developer > Allow JavaScript from Apple Events). Exported for tests. |

Never interpolate user-controlled strings directly into AppleScript — always use `toAppleScriptString` or `toAppleScriptNumber`.

---

## Browser Context Pinning (`electron/services/linkedin.service.ts`)

After the profile page opens, the service acquires an `AutomationBrowserContext` containing `{ browserApp, windowId, tabId }`. All subsequent AppleScript operations target this exact window and tab — not "the active tab" of an arbitrary window.

Key implementation details:

- **Integer IDs:** Window and tab IDs are passed as bare integers via `toAppleScriptNumber()`, not quoted strings. AppleScript compares them with `is` equality against native integer IDs.
- **Tab activation loop:** `focusAutomationContext` iterates `every tab of targetWindow` with an explicit `repeat` loop to find the target tab by ID, then sets `active tab index of targetWindow to i` using the positional index. The old `index of targetTab` approach was unreliable.
- **Post-focus operations:** After `focusAutomationContext` succeeds, `navigateAutomationContextToUrl`, `waitForTabLoad`, and `executeTabJavaScript` all operate on `active tab of targetWindow` — relying on already-confirmed focus rather than re-querying by tab ID.
- **Tab-not-found recovery:** If the automation tab is closed, `focusAutomationContext` throws `stale_selectors` and clears `automationContext` so the next operation re-acquires a fresh context.

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
- `permission_issue` — Accessibility/Automation not granted, or Chrome's "Allow JavaScript from Apple Events" is off
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
| `linkedin-selectors.test.ts` | DOM selector strings, URL normalization, browser context contracts (automation queue, window/tab pinning, no `index of targetTab`) |
| `reminder.logic.test.ts` | Reminder scheduling, snooze, next-reminder calculation |
| `scheduler.logic.test.ts` | Catch-up, retry backoff, mutex, past-due one-time logic |
| `schedule-picker.test.ts` | Calendar math, time formatting, meridiem conversion |
| `toast-contract.test.ts` | Toast variant contracts |

Run all: `npm run verify` (tests + both typechecks).

---

## Browser Access Preflight (`checkChromeAccess`)

The Settings-tab access check runs two probes against the configured browser:

1. **Reachability** — `tell application "<browser>" to return version` (triggers the macOS Automation prompt on first run; launches the browser if needed).
2. **JS-from-Apple-Events** — `checkJavaScriptFromAppleEvents()` executes a harmless `1 + 1` in the active tab of the front window. If Chrome reports "Executing JavaScript through AppleScript is turned off", the check returns `granted: false` with instructions to enable **View > Developer > Allow JavaScript from Apple Events**. Other JS errors (e.g. a `chrome://` page in the active tab) or zero open windows do **not** fail the check — they don't prove the setting is off.

Chrome ships with JS-from-Apple-Events disabled, so this is the most common first-run blocker. The error is classified as `permission_issue` (non-retryable) and the message phrase `Allow JavaScript from Apple Events` is in the scheduler's `NON_RETRYABLE_PATTERNS`, so a send that hits it fails once instead of burning the retry backoff.

---

## Packaging & Distribution (macOS)

- `npm run dist:dmg` → `dist/LockedIn-<version>-arm64.dmg` via electron-builder (config in `package.json` `build` field).
- **Entitlements:** `resources/entitlements.mac.plist` — Electron hardened-runtime defaults plus `com.apple.security.automation.apple-events` (required for AppleScript automation under hardened runtime). Excluded from `extraResources` so it isn't shipped inside the app.
- **Info.plist:** `mac.extendInfo` injects `NSAppleEventsUsageDescription` so the macOS Automation consent prompt is correctly attributed to LockedIn.
- **Signing:** falls back to an ad-hoc signature when no Developer ID identity is in the keychain. Consequences: on macOS 15+ downloaded builds need System Settings > Privacy & Security > "Open Anyway" (right-click → Open no longer bypasses Gatekeeper), and TCC grants (Accessibility/Automation) are tied to the signature, so they may need re-granting after each rebuild. Proper distribution requires Developer ID signing + notarization.
- **better-sqlite3** is rebuilt for Electron by electron-builder and `asarUnpack`ed; tray/app icons ship via `extraResources` and resolve through `getResourcePath()` in `electron/main.ts`.

---

## Known Fragility

- LinkedIn DOM selectors can break any time LinkedIn ships a UI update. The `LINKEDIN_SELECTORS` const + tests make this recoverable quickly.
- Scheduler jobs are in-memory — the app must stay running. Sleep/wake resync covers normal Mac sleep but not force-quit.
- AppleScript requires **Accessibility permissions** (`System Settings > Privacy & Security > Accessibility`). Without them, every send fails with a non-retryable `permission_issue`.
