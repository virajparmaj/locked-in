import { runAppleScript, runCommand } from '../utils/applescript'
import { getSettings } from './db.service'
import { createLogger } from '../utils/logger'
import type { SendResult, AccessibilityStatus } from '../../shared/types'

const log = createLogger('linkedin')

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * All LinkedIn DOM selectors in one place for easy updating
 * when LinkedIn changes their markup.
 */
export const LINKEDIN_SELECTORS = {
  MESSAGE_INPUT: 'div.msg-form__contenteditable',
  SEND_BUTTON: 'button.msg-form__send-button',
  PROFILE_URL_PREFIX: 'https://www.linkedin.com/in/'
} as const

/** Track last send timestamp for rate limiting */
let lastSendTimestamp = 0

/**
 * Poll for the message overlay to appear after clicking the Message button.
 * Waits 2s initially, then checks up to 3 more times with 1s intervals.
 */
async function waitForOverlay(
  browserApp: string,
  selector: string,
  initialWaitMs = 2000,
  maxRetries = 3,
  retryWaitMs = 1000
): Promise<boolean> {
  await sleep(initialWaitMs)

  for (let i = 0; i <= maxRetries; i++) {
    try {
      const checkScript = `
        tell application "${browserApp}"
          tell active tab of first window
            execute javascript "document.querySelector('${selector}') ? 'found' : 'not_found'"
          end tell
        end tell
      `
      const result = await runAppleScript(checkScript, 5000)
      if (result.includes('found') && !result.includes('not_found')) return true
    } catch {
      // continue retrying
    }
    if (i < maxRetries) await sleep(retryWaitMs)
  }
  return false
}

/**
 * Send a LinkedIn message via Chrome AppleScript + JavaScript injection.
 *
 * Flow:
 * 1. Check/launch Google Chrome
 * 2. Navigate to LinkedIn profile page
 * 3. Wait for page load
 * 4. Click "Message" button on profile
 * 5. Wait for message overlay to appear
 * 6. Inject message text via execute javascript
 * 7. Click send button via execute javascript
 */
export async function sendLinkedInMessage(
  linkedinSlug: string,
  message: string,
  dryRun: boolean
): Promise<SendResult> {
  const settings = getSettings()
  const isDryRun = dryRun || settings.globalDryRun
  const browserApp = settings.browserApp.replace(/['"\\;\n\r]/g, '')

  try {
    // Rate limiting check
    const now = Date.now()
    const elapsed = now - lastSendTimestamp
    if (lastSendTimestamp > 0 && elapsed < settings.minIntervalBetweenSends) {
      return {
        success: false,
        error: `Rate limited: minimum interval not met (${Math.ceil((settings.minIntervalBetweenSends - elapsed) / 1000)}s remaining)`,
        dryRun: isDryRun
      }
    }

    // Step 0: Check if Chrome is running, launch if not
    try {
      const checkScript = `tell application "System Events" to (name of processes) contains "${browserApp}"`
      const running = await runAppleScript(checkScript)
      if (running.trim() === 'false') {
        try {
          await runCommand('open', ['-a', browserApp])
        } catch {
          return { success: false, error: `${browserApp} is not installed or could not be launched`, dryRun: isDryRun }
        }
        // Verify it launched (3 checks, 1s apart)
        let launched = false
        for (let i = 0; i < 3; i++) {
          await sleep(1000)
          try {
            const recheck = await runAppleScript(checkScript)
            if (recheck.trim() === 'true') { launched = true; break }
          } catch { /* continue checking */ }
        }
        if (!launched) {
          return { success: false, error: `${browserApp} failed to start after 3 seconds`, dryRun: isDryRun }
        }
      }
    } catch {
      // If we can't check, proceed anyway
    }

    // Step 1: Navigate to LinkedIn profile page
    const profileUrl = `${LINKEDIN_SELECTORS.PROFILE_URL_PREFIX}${encodeURIComponent(linkedinSlug)}/`

    const navigateScript = `
      tell application "${browserApp}"
        activate
        if (count of windows) = 0 then make new window
        set URL of active tab of first window to "${profileUrl}"
      end tell
    `
    await runAppleScript(navigateScript)

    // Step 2: Wait for profile page to load (LinkedIn is a heavy SPA)
    await sleep(settings.pageLoadDelayMs)

    if (isDryRun) {
      log.info(`Dry run: would send to ${linkedinSlug}`)
      lastSendTimestamp = Date.now()
      return { success: true, dryRun: true }
    }

    // Step 3: Click the "Message" button on the profile page
    const clickMessageScript = `
      tell application "${browserApp}"
        tell active tab of first window
          execute javascript "
            (function() {
              var ariaBtn = document.querySelector('button[aria-label*=\\"Message\\"]');
              if (ariaBtn && ariaBtn.textContent.trim().startsWith('Message')) {
                ariaBtn.click();
                return 'clicked';
              }
              var buttons = document.querySelectorAll('button');
              for (var i = 0; i < buttons.length; i++) {
                if (buttons[i].textContent.trim() === 'Message') {
                  buttons[i].click();
                  return 'clicked';
                }
              }
              return 'message_button_not_found';
            })()
          "
        end tell
      end tell
    `
    const clickResult = await runAppleScript(clickMessageScript, 15000)
    if (clickResult.includes('message_button_not_found')) {
      return {
        success: false,
        error: 'Could not find Message button on profile. You may not be connected to this person or LinkedIn UI has changed.',
        dryRun: false
      }
    }

    // Step 4: Wait for the message overlay to appear
    const overlayReady = await waitForOverlay(browserApp, LINKEDIN_SELECTORS.MESSAGE_INPUT)
    if (!overlayReady) {
      return {
        success: false,
        error: 'Message overlay did not appear. LinkedIn may be slow or UI has changed.',
        dryRun: false
      }
    }

    // Step 5: Inject message text via JavaScript execution
    const escapedMessage = message
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '')

    const injectScript = `
      tell application "${browserApp}"
        tell active tab of first window
          execute javascript "
            (function() {
              var els = document.querySelectorAll('${LINKEDIN_SELECTORS.MESSAGE_INPUT}');
              var el = els.length > 0 ? els[els.length - 1] : null;
              if (el) {
                el.focus();
                var p = el.querySelector('p') || el;
                p.innerText = '${escapedMessage}';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return 'ok';
              }
              return 'selector_not_found';
            })()
          "
        end tell
      end tell
    `
    const injectResult = await runAppleScript(injectScript, 15000)
    if (injectResult.includes('selector_not_found')) {
      return {
        success: false,
        error: 'Could not find message input in overlay. The Message popup may not have opened, or LinkedIn UI has changed.',
        dryRun: false
      }
    }

    // Step 6: Wait then click send
    await sleep(settings.sendDelayMs)

    const sendScript = `
      tell application "${browserApp}"
        tell active tab of first window
          execute javascript "
            (function() {
              var btns = document.querySelectorAll('${LINKEDIN_SELECTORS.SEND_BUTTON}');
              var btn = btns.length > 0 ? btns[btns.length - 1] : null;
              if (btn && !btn.disabled) {
                btn.click();
                return 'sent';
              }
              return 'send_button_not_found';
            })()
          "
        end tell
      end tell
    `
    const sendResult = await runAppleScript(sendScript, 15000)
    if (sendResult.includes('send_button_not_found')) {
      return {
        success: false,
        error: 'Could not find send button in message overlay. LinkedIn UI may have changed.',
        dryRun: false
      }
    }

    lastSendTimestamp = Date.now()
    return { success: true, dryRun: false }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    return { success: false, error: errMsg, dryRun: isDryRun }
  }
}

/**
 * Check if Chrome is accessible via AppleScript.
 */
export async function checkChromeAccess(): Promise<AccessibilityStatus> {
  try {
    const settings = getSettings()
    const browserApp = settings.browserApp.replace(/['"\\;\n\r]/g, '')
    // Test that we can talk to Chrome via AppleScript
    await runAppleScript(`tell application "${browserApp}" to return name of front window`, 5000)
    return { granted: true }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    return { granted: false, error: errMsg }
  }
}

/**
 * Open LinkedIn in Chrome so the user can verify they're logged in.
 */
export async function openLinkedInInChrome(): Promise<void> {
  const settings = getSettings()
  const browserApp = settings.browserApp.replace(/['"\\;\n\r]/g, '')
  const script = `
    tell application "${browserApp}"
      activate
      if (count of windows) = 0 then make new window
      set URL of active tab of first window to "https://www.linkedin.com"
    end tell
  `
  await runAppleScript(script)
}
