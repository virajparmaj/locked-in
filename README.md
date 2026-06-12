<div align="center">
  <img src="locked-in.png" width="120" alt="LockedIn logo" />

  # LockedIn

  **Local LinkedIn browser automation scheduler for macOS**
</div>

---

## Download & Install

### Option 1 — Pre-built DMG (Recommended)

1. Go to the [Releases](../../releases) page and download the latest `LockedIn-<version>-arm64.dmg`
2. Open the `.dmg` file
3. Drag **LockedIn** into your **Applications** folder
4. **First launch (unsigned build):** double-click the app — macOS will block it. Then go to **System Settings > Privacy & Security**, scroll down to the *"LockedIn was blocked"* message, and click **Open Anyway**. This is a one-time step.
   - On macOS 14 and earlier you can instead right-click the app → **Open**.
5. LockedIn lives in your **menu bar** — look for the icon in the top-right of your screen

### Option 2 — Build from Source

**Requirements:** Node.js 18+, npm

```bash
git clone <repo-url>
cd locked-in
npm install
npm run dist:dmg
```

The `.dmg` will be built into the `dist/` folder. Open it and follow the same install steps above. Locally built apps open without the Gatekeeper step.

---

## First-Time Setup (Required)

LockedIn drives your real browser, so a few one-time permissions are needed before the first send works. The **Settings** tab shows automation status and will tell you what's missing.

1. **Log into LinkedIn in Chrome** — LockedIn uses your existing logged-in session.
2. **Allow JavaScript from Apple Events in Chrome** — in Chrome's menu bar: **View > Developer > Allow JavaScript from Apple Events**. Chrome ships with this off; without it every send fails.
3. **Automation permission** — the first time LockedIn talks to Chrome, macOS asks *"LockedIn wants to control Google Chrome"* → click **Allow**. (Manage later in System Settings > Privacy & Security > Automation.)
4. **Accessibility permission** — add LockedIn under **System Settings > Privacy & Security > Accessibility**.
5. **Notifications** (optional) — allow notifications so you see send results and reminders.

> **Note (unsigned builds):** macOS ties Automation/Accessibility grants to the app's code signature. After installing an updated build you may need to re-grant permissions 3 and 4.

---

## Development

```bash
npm install      # install dependencies
npm run dev      # start in dev mode (Electron + Vite hot reload)
npm run build    # build renderer + main
npm test         # run tests
```

---

## About

LockedIn runs entirely on your machine — no cloud, no accounts, and no LinkedIn API integration. It automates your logged-in LinkedIn browser session with AppleScript and in-page JavaScript from a native macOS menu bar app: open the saved profile URL, click **Message**, type into the compose box, then click **Send**.

Browser support is based on Chrome/Chromium-style AppleScript control on macOS. Google Chrome is the default and tested browser, and other browsers are only expected to work if they expose the same AppleScript window/tab model.
