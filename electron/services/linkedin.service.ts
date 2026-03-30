import { runAppleScript, runCommand, toAppleScriptString, toAppleScriptNumber } from '../utils/applescript'
import { getSettings } from './db.service'
import { createLogger } from '../utils/logger'
import {
  areSameLinkedInProfileUrls,
  extractLinkedInSlug,
  normalizeLinkedInProfileUrl,
  normalizeLinkedInRecipientText
} from '@shared/linkedin'
import type { SendResult, AccessibilityStatus } from '../../shared/types'

const log = createLogger('linkedin')

const AUTOMATION_WINDOW_NAME = 'LockedIn Automation'
const CONTEXT_ID_SEPARATOR = '::'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * All LinkedIn DOM selectors in one place for easy updating
 * when LinkedIn changes their markup.
 */
export const LINKEDIN_SELECTORS = {
  PROFILE_ROOT: 'main',
  MESSAGE_INPUT: 'div.msg-form__contenteditable',
  SEND_BUTTON: 'button.msg-form__send-button',
  OVERLAY_CONTAINER: 'section.msg-overlay-bubble, div.msg-overlay-bubble, aside.msg-overlay-bubble, section.msg-overlay-conversation-bubble, div.msg-overlay-conversation-bubble'
} as const

type LinkedInOperation = 'send' | 'compose' | 'open_home'

type LinkedInFailureCode =
  | 'invalid_profile_url'
  | 'rate_limited'
  | 'browser_launch_failure'
  | 'permission_issue'
  | 'login_wall'
  | 'profile_mismatch'
  | 'missing_message_button'
  | 'overlay_mismatch'
  | 'stale_selectors'
  | 'send_confirmation_missing'
  | 'unexpected'

interface AutomationBrowserContext {
  browserApp: string
  windowId: string
  tabId: string
}

interface TargetProfile {
  profileUrl: string
  profileSlug: string
  profileName: string
  normalizedProfileName: string
}

interface ProfileInspection {
  locationHref: string
  title: string
  profileName: string
  messageButtonPresent: boolean
  loginWall: boolean
  bodySnippet: string
}

interface OverlayCandidate {
  overlayId: string
  recipientUrl: string
  recipientSlug: string
  recipientName: string
  normalizedRecipientName: string
  draftText: string
  sendButtonEnabled: boolean
}

interface ComposeFlowContext {
  browserContext: AutomationBrowserContext
  target: TargetProfile
  overlay: OverlayCandidate
}

interface SendConfirmationState {
  confirmed: boolean
  reason: string
  draftText: string
  sendButtonEnabled: boolean
  outgoingText: string
  overlayPresent: boolean
}

class LinkedInAutomationError extends Error {
  code: LinkedInFailureCode
  details?: Record<string, unknown>

  constructor(code: LinkedInFailureCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'LinkedInAutomationError'
    this.code = code
    this.details = details
  }
}

/** Track last send timestamp for rate limiting */
let lastSendTimestamp = 0
let automationContext: AutomationBrowserContext | null = null
let automationQueue: Promise<void> = Promise.resolve()

function sanitizeBrowserAppName(browserApp: string): string {
  const sanitized = browserApp.replace(/['"\\;\n\r]/g, '').trim()
  return sanitized || 'Google Chrome'
}

function normalizeMessageText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function makeError(
  code: LinkedInFailureCode,
  message: string,
  details?: Record<string, unknown>
): LinkedInAutomationError {
  return new LinkedInAutomationError(code, message, details)
}

function isLinkedInAutomationError(error: unknown): error is LinkedInAutomationError {
  return error instanceof LinkedInAutomationError
}

function getContextLogFields(context: AutomationBrowserContext | null): Record<string, unknown> {
  if (!context) return {}

  return {
    browserApp: context.browserApp,
    windowId: context.windowId,
    tabId: context.tabId
  }
}

function jsStringLiteral(value: string): string {
  return JSON.stringify(value)
}

function parseContextIds(rawValue: string): { windowId: string, tabId: string } {
  const [windowId, tabId] = rawValue.trim().split(CONTEXT_ID_SEPARATOR)

  if (!windowId || !tabId) {
    throw makeError('stale_selectors', 'LinkedIn automation could not determine the browser window and tab IDs.', {
      rawValue
    })
  }

  return { windowId, tabId }
}

function describeOverlayCandidates(candidates: OverlayCandidate[]): string {
  return candidates
    .map((candidate) => candidate.recipientName || candidate.recipientSlug || 'unknown recipient')
    .join(', ')
}

function classifyLinkedInError(error: unknown): LinkedInAutomationError {
  if (isLinkedInAutomationError(error)) return error

  const rawMessage = error instanceof Error ? error.message : String(error)

  if (/Accessibility permission/i.test(rawMessage) || /Automation permission/i.test(rawMessage)) {
    return makeError('permission_issue', rawMessage)
  }

  if (/not logged in/i.test(rawMessage) || /login wall/i.test(rawMessage)) {
    return makeError('login_wall', rawMessage)
  }

  if (/could not be launched|failed to start|not installed/i.test(rawMessage)) {
    return makeError('browser_launch_failure', rawMessage)
  }

  return makeError('unexpected', rawMessage)
}

async function withAutomationLock<T>(
  operation: LinkedInOperation,
  meta: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  let release!: () => void
  const previous = automationQueue
  const next = new Promise<void>((resolve) => {
    release = resolve
  })

  automationQueue = previous.catch(() => undefined).then(() => next)

  log.debug('Waiting for LinkedIn automation lock', { operation, ...meta })
  await previous.catch(() => undefined)
  log.debug('Acquired LinkedIn automation lock', { operation, ...meta })

  try {
    return await fn()
  } finally {
    release()
    log.debug('Released LinkedIn automation lock', { operation, ...meta })
  }
}

async function ensureBrowserRunning(browserApp: string): Promise<void> {
  const checkScript = `return application ${toAppleScriptString(browserApp)} is running`

  try {
    const running = await runAppleScript(checkScript)
    if (running.trim() === 'true') return
  } catch (error) {
    throw classifyLinkedInError(error)
  }

  log.info('Launching browser for LinkedIn automation', { browserApp })

  try {
    await runCommand('open', ['-a', browserApp], 10000)
  } catch (error) {
    throw makeError(
      'browser_launch_failure',
      `${browserApp} could not be launched. Browser launch failure: ${error instanceof Error ? error.message : String(error)}`,
      { browserApp }
    )
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(1000)

    try {
      const recheck = await runAppleScript(checkScript)
      if (recheck.trim() === 'true') return
    } catch (error) {
      throw classifyLinkedInError(error)
    }
  }

  throw makeError(
    'browser_launch_failure',
    `${browserApp} failed to start after 5 seconds. Browser launch failure.`,
    { browserApp }
  )
}

async function hasUsableAutomationContext(context: AutomationBrowserContext): Promise<boolean> {
  const script = `
    tell application ${toAppleScriptString(context.browserApp)}
      if (count of (every window whose id is ${toAppleScriptNumber(context.windowId)})) = 0 then
        return "missing_window"
      end if

      set targetWindow to first window whose id is ${toAppleScriptNumber(context.windowId)}
      set tabList to every tab of targetWindow
      repeat with i from 1 to (count of tabList)
        if id of (item i of tabList) is ${toAppleScriptNumber(context.tabId)} then
          return "ok"
        end if
      end repeat
      return "missing_tab"
    end tell
  `

  try {
    return (await runAppleScript(script, 5000)).trim() === 'ok'
  } catch {
    return false
  }
}

async function createAutomationContext(browserApp: string): Promise<AutomationBrowserContext> {
  const script = `
    tell application ${toAppleScriptString(browserApp)}
      activate
      set targetWindow to make new window
      set given name of targetWindow to ${toAppleScriptString(AUTOMATION_WINDOW_NAME)}
      set targetTab to active tab of targetWindow
      return (id of targetWindow as text) & ${toAppleScriptString(CONTEXT_ID_SEPARATOR)} & (id of targetTab as text)
    end tell
  `

  const rawContext = await runAppleScript(script, 10000)
  const { windowId, tabId } = parseContextIds(rawContext)
  const context = { browserApp, windowId, tabId }

  log.info('Created dedicated LinkedIn automation tab', getContextLogFields(context))
  return context
}

async function getOrCreateAutomationContext(browserApp: string): Promise<AutomationBrowserContext> {
  if (automationContext && automationContext.browserApp !== browserApp) {
    automationContext = null
  }

  if (automationContext && await hasUsableAutomationContext(automationContext)) {
    return automationContext
  }

  automationContext = await createAutomationContext(browserApp)
  return automationContext
}

async function focusAutomationContext(context: AutomationBrowserContext): Promise<void> {
  const script = `
    tell application ${toAppleScriptString(context.browserApp)}
      activate
      set targetWindow to first window whose id is ${toAppleScriptNumber(context.windowId)}
      set tabList to every tab of targetWindow
      repeat with i from 1 to (count of tabList)
        if id of (item i of tabList) is ${toAppleScriptNumber(context.tabId)} then
          set active tab index of targetWindow to i
          set index of targetWindow to 1
          return "ok"
        end if
      end repeat
      return "tab_not_found"
    end tell
  `

  try {
    const result = await runAppleScript(script, 5000)
    if (result.trim() === 'tab_not_found') {
      automationContext = null
      throw makeError(
        'stale_selectors',
        'LinkedIn automation tab was closed or not found in the browser window.',
        getContextLogFields(context)
      )
    }
  } catch (error) {
    if (isLinkedInAutomationError(error)) throw error
    automationContext = null
    throw classifyLinkedInError(error)
  }
}

async function navigateAutomationContextToUrl(
  context: AutomationBrowserContext,
  url: string
): Promise<void> {
  await focusAutomationContext(context)

  const script = `
    tell application ${toAppleScriptString(context.browserApp)}
      set targetWindow to first window whose id is ${toAppleScriptNumber(context.windowId)}
      set URL of active tab of targetWindow to ${toAppleScriptString(url)}
      return URL of active tab of targetWindow
    end tell
  `

  try {
    await runAppleScript(script, 10000)
  } catch (error) {
    automationContext = null
    throw classifyLinkedInError(error)
  }
}

async function waitForTabLoad(
  context: AutomationBrowserContext,
  expectedUrl: string,
  maxRetries = 12,
  retryWaitMs = 500
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const script = `
      tell application ${toAppleScriptString(context.browserApp)}
        set targetWindow to first window whose id is ${toAppleScriptNumber(context.windowId)}
        return (loading of active tab of targetWindow as text) & ${toAppleScriptString(CONTEXT_ID_SEPARATOR)} & (URL of active tab of targetWindow as text)
      end tell
    `

    try {
      const result = await runAppleScript(script, 5000)
      const [loadingState, currentUrl] = result.split(CONTEXT_ID_SEPARATOR)

      if (loadingState === 'false' && currentUrl && currentUrl.length > 0) {
        log.debug('LinkedIn automation tab load complete', {
          ...getContextLogFields(context),
          currentUrl,
          expectedUrl
        })
        return
      }
    } catch (error) {
      throw classifyLinkedInError(error)
    }

    await sleep(retryWaitMs)
  }

  throw makeError(
    'stale_selectors',
    'LinkedIn automation tab did not finish loading the expected profile page in time.',
    { expectedUrl, ...getContextLogFields(context) }
  )
}

async function executeTabJavaScript(
  context: AutomationBrowserContext,
  javascript: string,
  timeoutMs = 15000
): Promise<string> {
  await focusAutomationContext(context)

  const script = `
    tell application ${toAppleScriptString(context.browserApp)}
      set targetWindow to first window whose id is ${toAppleScriptNumber(context.windowId)}
      tell active tab of targetWindow
        execute javascript ${toAppleScriptString(javascript)}
      end tell
    end tell
  `

  try {
    return await runAppleScript(script, timeoutMs)
  } catch (error) {
    automationContext = null
    throw classifyLinkedInError(error)
  }
}

async function executeTabJson<T>(
  context: AutomationBrowserContext,
  javascript: string,
  timeoutMs = 15000
): Promise<T> {
  const raw = await executeTabJavaScript(context, javascript, timeoutMs)

  try {
    return JSON.parse(raw) as T
  } catch {
    throw makeError(
      'stale_selectors',
      'LinkedIn automation received an invalid browser response while inspecting the page.',
      { raw }
    )
  }
}

async function inspectProfilePage(context: AutomationBrowserContext): Promise<ProfileInspection> {
  const script = `
    (() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      const root = document.querySelector(${jsStringLiteral(LINKEDIN_SELECTORS.PROFILE_ROOT)}) || document.body;
      const buttons = Array.from((root || document).querySelectorAll('button'));
      const messageButton = buttons.find((button) => {
        const text = normalize(button.textContent);
        const label = normalize(button.getAttribute('aria-label'));
        if (!isVisible(button) || button.disabled) return false;
        if (button.closest('.msg-overlay-bubble, .msg-conversations-container')) return false;
        return text === 'message' || label === 'message' || label.startsWith('message ');
      });

      const loginWall = window.location.pathname.includes('/authwall') ||
        window.location.pathname.includes('/checkpoint') ||
        Boolean(document.querySelector('input[name="session_key"], input[name="session_password"], form.login__form, .sign-in-modal')) ||
        (document.title || '').toLowerCase().includes('sign in');

      const profileNameElement =
        (root && root.querySelector('h1')) ||
        document.querySelector('[data-anonymize="person-name"]') ||
        document.querySelector('.text-heading-xlarge');

      return JSON.stringify({
        locationHref: window.location.href,
        title: document.title || '',
        profileName: profileNameElement ? String(profileNameElement.textContent || '').replace(/\\s+/g, ' ').trim() : '',
        messageButtonPresent: Boolean(messageButton),
        loginWall,
        bodySnippet: document.body ? String(document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300) : ''
      });
    })();
  `

  return executeTabJson<ProfileInspection>(context, script, 15000)
}

function buildTargetProfile(profileUrl: string, page: ProfileInspection): TargetProfile {
  return {
    profileUrl,
    profileSlug: extractLinkedInSlug(profileUrl),
    profileName: page.profileName,
    normalizedProfileName: normalizeLinkedInRecipientText(page.profileName)
  }
}

function verifyProfilePage(profileUrl: string, page: ProfileInspection): TargetProfile {
  if (page.loginWall) {
    throw makeError(
      'login_wall',
      'LinkedIn login wall detected: not logged in. Sign in to LinkedIn in the selected browser and try again.',
      { locationHref: page.locationHref, title: page.title }
    )
  }

  if (!areSameLinkedInProfileUrls(page.locationHref, profileUrl)) {
    throw makeError(
      'profile_mismatch',
      `LinkedIn automation landed on the wrong profile. Expected ${profileUrl} but browser was on ${page.locationHref}.`,
      { expectedProfileUrl: profileUrl, actualProfileUrl: page.locationHref }
    )
  }

  if (!page.messageButtonPresent) {
    throw makeError(
      'missing_message_button',
      'LinkedIn profile verified, but the Message button was not found. You may not be connected to this person or LinkedIn UI has changed.',
      { profileUrl, title: page.title, bodySnippet: page.bodySnippet }
    )
  }

  return buildTargetProfile(profileUrl, page)
}

async function clickMessageButton(context: AutomationBrowserContext): Promise<void> {
  const script = `
    (() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      const root = document.querySelector(${jsStringLiteral(LINKEDIN_SELECTORS.PROFILE_ROOT)}) || document.body;
      const buttons = Array.from((root || document).querySelectorAll('button'));
      const messageButton = buttons.find((button) => {
        const text = normalize(button.textContent);
        const label = normalize(button.getAttribute('aria-label'));
        if (!isVisible(button) || button.disabled) return false;
        if (button.closest('.msg-overlay-bubble, .msg-conversations-container')) return false;
        return text === 'message' || label === 'message' || label.startsWith('message ');
      });

      if (!messageButton) {
        return JSON.stringify({ status: 'message_button_not_found' });
      }

      messageButton.click();
      return JSON.stringify({ status: 'clicked' });
    })();
  `

  const result = await executeTabJson<{ status: string }>(context, script, 15000)

  if (result.status !== 'clicked') {
    throw makeError(
      'missing_message_button',
      'LinkedIn profile verified, but the Message button could not be clicked in the dedicated automation tab.',
      getContextLogFields(context)
    )
  }
}

async function inspectOverlayCandidates(context: AutomationBrowserContext): Promise<OverlayCandidate[]> {
  const script = `
    (() => {
      const selectors = ${jsStringLiteral(LINKEDIN_SELECTORS.OVERLAY_CONTAINER)}.split(',').map((value) => value.trim()).filter(Boolean);
      const seen = new Set();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const sanitizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();

      const containers = [];
      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (seen.has(node) || !isVisible(node)) return;
          seen.add(node);
          containers.push(node);
        });
      });

      const candidates = containers
        .map((container, index) => {
          const input = container.querySelector(${jsStringLiteral(LINKEDIN_SELECTORS.MESSAGE_INPUT)});
          if (!input) return null;

          if (!container.dataset.lockedinOverlayId) {
            container.dataset.lockedinOverlayId = 'lockedin-overlay-' + (index + 1);
          }

          const recipientLink = Array.from(container.querySelectorAll('a[href*="/in/"]'))
            .find((link) => link instanceof HTMLAnchorElement && !!link.href);
          const recipientNameElement =
            container.querySelector('.msg-overlay-bubble-header__title') ||
            container.querySelector('.msg-overlay-bubble-header__title a') ||
            container.querySelector('header h2') ||
            container.querySelector('[data-anonymize="person-name"]');
          const sendButton = container.querySelector(${jsStringLiteral(LINKEDIN_SELECTORS.SEND_BUTTON)});

          return {
            overlayId: container.dataset.lockedinOverlayId,
            recipientUrl: recipientLink instanceof HTMLAnchorElement ? recipientLink.href : '',
            recipientName: sanitizeText(recipientNameElement ? recipientNameElement.textContent : ''),
            draftText: sanitizeText(input instanceof HTMLElement ? input.innerText : ''),
            sendButtonEnabled: Boolean(sendButton && !(sendButton instanceof HTMLButtonElement && sendButton.disabled))
          };
        })
        .filter(Boolean);

      return JSON.stringify({ candidates });
    })();
  `

  const result = await executeTabJson<{ candidates: Array<{
    overlayId: string
    recipientUrl: string
    recipientName: string
    draftText: string
    sendButtonEnabled: boolean
  }> }>(context, script, 15000)

  return result.candidates.map((candidate) => ({
    overlayId: candidate.overlayId,
    recipientUrl: candidate.recipientUrl,
    recipientSlug: extractLinkedInSlug(candidate.recipientUrl),
    recipientName: candidate.recipientName,
    normalizedRecipientName: normalizeLinkedInRecipientText(candidate.recipientName),
    draftText: candidate.draftText,
    sendButtonEnabled: candidate.sendButtonEnabled
  }))
}

function selectMatchingOverlay(
  candidates: OverlayCandidate[],
  target: TargetProfile
): OverlayCandidate | null {
  for (const candidate of candidates) {
    if (candidate.recipientUrl && areSameLinkedInProfileUrls(candidate.recipientUrl, target.profileUrl)) {
      return candidate
    }

    if (candidate.recipientSlug && candidate.recipientSlug === target.profileSlug) {
      return candidate
    }

    if (
      candidate.normalizedRecipientName &&
      target.normalizedProfileName &&
      candidate.normalizedRecipientName === target.normalizedProfileName
    ) {
      return candidate
    }
  }

  return null
}

async function waitForMatchingOverlay(
  context: AutomationBrowserContext,
  target: TargetProfile,
  maxRetries = 6,
  retryWaitMs = 1000
): Promise<OverlayCandidate> {
  let lastCandidates: OverlayCandidate[] = []

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await sleep(attempt === 0 ? 1500 : retryWaitMs)

    const candidates = await inspectOverlayCandidates(context)
    lastCandidates = candidates
    const matched = selectMatchingOverlay(candidates, target)

    log.debug('Checked LinkedIn compose overlay candidates', {
      ...getContextLogFields(context),
      profileUrl: target.profileUrl,
      attempt: attempt + 1,
      candidateCount: candidates.length,
      candidates: candidates.map((candidate) => ({
        overlayId: candidate.overlayId,
        recipientName: candidate.recipientName,
        recipientUrl: candidate.recipientUrl
      }))
    })

    if (matched) return matched
  }

  if (lastCandidates.length > 0) {
    const sawRecipientContext = lastCandidates.some(
      (candidate) => candidate.recipientUrl || candidate.recipientSlug || candidate.normalizedRecipientName
    )

    if (sawRecipientContext) {
      throw makeError(
        'overlay_mismatch',
        `Overlay recipient mismatch. Expected compose for ${target.profileUrl}, but found ${describeOverlayCandidates(lastCandidates)}.`,
        {
          profileUrl: target.profileUrl,
          candidates: lastCandidates.map((candidate) => ({
            overlayId: candidate.overlayId,
            recipientName: candidate.recipientName,
            recipientUrl: candidate.recipientUrl
          }))
        }
      )
    }
  }

  throw makeError(
    'stale_selectors',
    'LinkedIn compose overlay did not appear with a verifiable recipient context. LinkedIn selectors may be stale.',
    { profileUrl: target.profileUrl, ...getContextLogFields(context) }
  )
}

async function focusMessageInput(context: AutomationBrowserContext, overlayId: string): Promise<void> {
  const script = `
    (() => {
      const overlay = document.querySelector(${jsStringLiteral(`[data-lockedin-overlay-id="${overlayId}"]`)});
      if (!(overlay instanceof HTMLElement)) {
        return JSON.stringify({ status: 'overlay_not_found' });
      }

      const input = overlay.querySelector(${jsStringLiteral(LINKEDIN_SELECTORS.MESSAGE_INPUT)});
      if (!(input instanceof HTMLElement)) {
        return JSON.stringify({ status: 'input_not_found' });
      }

      const target = input.querySelector('p') instanceof HTMLElement ? input.querySelector('p') : input;
      if (!(target instanceof HTMLElement)) {
        return JSON.stringify({ status: 'focus_target_not_found' });
      }

      input.click();
      input.focus();
      target.click();
      target.focus();

      return JSON.stringify({ status: 'focused' });
    })();
  `

  const result = await executeTabJson<{ status: string }>(context, script, 15000)
  if (result.status !== 'focused') {
    throw makeError(
      'stale_selectors',
      'LinkedIn compose overlay opened, but the message input could not be focused.',
      { overlayId, status: result.status, ...getContextLogFields(context) }
    )
  }
}

async function setOverlayDraftMessage(
  context: AutomationBrowserContext,
  overlayId: string,
  message: string
): Promise<void> {
  const script = `
    (() => {
      const overlay = document.querySelector(${jsStringLiteral(`[data-lockedin-overlay-id="${overlayId}"]`)});
      if (!(overlay instanceof HTMLElement)) {
        return JSON.stringify({ status: 'overlay_not_found' });
      }

      const input = overlay.querySelector(${jsStringLiteral(LINKEDIN_SELECTORS.MESSAGE_INPUT)});
      if (!(input instanceof HTMLElement)) {
        return JSON.stringify({ status: 'input_not_found' });
      }

      const target = input.querySelector('p') instanceof HTMLElement ? input.querySelector('p') : input;
      target.innerText = ${jsStringLiteral(message)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('input', { bubbles: true }));

      return JSON.stringify({
        status: 'ok',
        draftText: String(input.innerText || target.textContent || '').replace(/\\s+/g, ' ').trim()
      });
    })();
  `

  const result = await executeTabJson<{ status: string, draftText: string }>(context, script, 15000)

  if (result.status !== 'ok') {
    throw makeError(
      'stale_selectors',
      'LinkedIn compose overlay could not accept the message draft.',
      { overlayId, status: result.status, ...getContextLogFields(context) }
    )
  }

  if (normalizeMessageText(result.draftText) !== normalizeMessageText(message)) {
    throw makeError(
      'stale_selectors',
      'LinkedIn compose overlay did not retain the expected draft text after typing.',
      {
        overlayId,
        expectedDraftText: normalizeMessageText(message),
        actualDraftText: normalizeMessageText(result.draftText)
      }
    )
  }
}

async function clickSendButton(context: AutomationBrowserContext, overlayId: string): Promise<void> {
  const script = `
    (() => {
      const overlay = document.querySelector(${jsStringLiteral(`[data-lockedin-overlay-id="${overlayId}"]`)});
      if (!(overlay instanceof HTMLElement)) {
        return JSON.stringify({ status: 'overlay_not_found' });
      }

      const sendButton = overlay.querySelector(${jsStringLiteral(LINKEDIN_SELECTORS.SEND_BUTTON)});
      if (!(sendButton instanceof HTMLButtonElement)) {
        return JSON.stringify({ status: 'send_button_not_found' });
      }

      if (sendButton.disabled) {
        return JSON.stringify({ status: 'send_button_disabled' });
      }

      sendButton.click();
      return JSON.stringify({ status: 'clicked' });
    })();
  `

  const result = await executeTabJson<{ status: string }>(context, script, 15000)

  if (result.status === 'send_button_not_found') {
    throw makeError(
      'stale_selectors',
      'LinkedIn compose overlay is open, but the Send button selector no longer matches.',
      { overlayId, ...getContextLogFields(context) }
    )
  }

  if (result.status === 'send_button_disabled') {
    throw makeError(
      'stale_selectors',
      'LinkedIn compose overlay Send button is disabled, so the draft was not ready to send.',
      { overlayId, ...getContextLogFields(context) }
    )
  }

  if (result.status !== 'clicked') {
    throw makeError(
      'stale_selectors',
      'LinkedIn compose overlay Send button could not be clicked.',
      { overlayId, status: result.status, ...getContextLogFields(context) }
    )
  }
}

async function inspectSendConfirmation(
  context: AutomationBrowserContext,
  overlayId: string,
  expectedMessage: string
): Promise<SendConfirmationState> {
  const normalizedExpectedMessage = normalizeMessageText(expectedMessage).toLowerCase()

  const script = `
    (() => {
      const overlay = document.querySelector(${jsStringLiteral(`[data-lockedin-overlay-id="${overlayId}"]`)});
      if (!(overlay instanceof HTMLElement)) {
        return JSON.stringify({
          confirmed: true,
          reason: 'overlay_closed',
          draftText: '',
          sendButtonEnabled: false,
          outgoingText: '',
          overlayPresent: false
        });
      }

      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const input = overlay.querySelector(${jsStringLiteral(LINKEDIN_SELECTORS.MESSAGE_INPUT)});
      const sendButton = overlay.querySelector(${jsStringLiteral(LINKEDIN_SELECTORS.SEND_BUTTON)});
      const draftText = input instanceof HTMLElement ? String(input.innerText || '').replace(/\\s+/g, ' ').trim() : '';
      const outgoingCandidates = Array.from(overlay.querySelectorAll('.msg-s-event-listitem__body, .msg-s-message-list__event, .msg-s-event-listitem, li'))
        .map((node) => normalize(node.textContent))
        .filter(Boolean);
      const outgoingText = outgoingCandidates.find((value) => value.includes(${jsStringLiteral(normalizedExpectedMessage)})) || '';
      const sendButtonEnabled = Boolean(sendButton && !(sendButton instanceof HTMLButtonElement && sendButton.disabled));
      const draftCleared = normalize(draftText).length === 0;
      const confirmed = Boolean(outgoingText) || draftCleared || !sendButtonEnabled;

      return JSON.stringify({
        confirmed,
        reason: outgoingText ? 'message_echo' : (draftCleared ? 'draft_cleared' : (!sendButtonEnabled ? 'send_disabled' : 'pending')),
        draftText,
        sendButtonEnabled,
        outgoingText,
        overlayPresent: true
      });
    })();
  `

  return executeTabJson<SendConfirmationState>(context, script, 15000)
}

async function waitForSendConfirmation(
  context: AutomationBrowserContext,
  overlayId: string,
  message: string,
  maxRetries = 6,
  retryWaitMs = 1000
): Promise<void> {
  let lastState: SendConfirmationState | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await sleep(retryWaitMs)
    lastState = await inspectSendConfirmation(context, overlayId, message)

    log.debug('Checked LinkedIn send confirmation state', {
      ...getContextLogFields(context),
      overlayId,
      attempt: attempt + 1,
      confirmationReason: lastState.reason,
      overlayPresent: lastState.overlayPresent,
      sendButtonEnabled: lastState.sendButtonEnabled,
      draftText: lastState.draftText,
      outgoingText: lastState.outgoingText
    })

    if (lastState.confirmed) return
  }

  throw makeError(
    'send_confirmation_missing',
    'LinkedIn send confirmation missing. The Send button was clicked, but no post-click confirmation signal appeared.',
    { overlayId, lastState, ...getContextLogFields(context) }
  )
}

async function openComposeFlow(
  browserApp: string,
  profileUrl: string,
  pageLoadDelayMs: number
): Promise<ComposeFlowContext> {
  await ensureBrowserRunning(browserApp)
  const browserContext = await getOrCreateAutomationContext(browserApp)

  log.info('Opening LinkedIn profile in dedicated automation tab', {
    profileUrl,
    ...getContextLogFields(browserContext)
  })

  await navigateAutomationContextToUrl(browserContext, profileUrl)
  await waitForTabLoad(browserContext, profileUrl)

  // LinkedIn is a heavy SPA and often renders profile actions after load completes.
  await sleep(pageLoadDelayMs)

  const page = await inspectProfilePage(browserContext)
  const target = verifyProfilePage(profileUrl, page)

  log.info('Verified intended LinkedIn profile before clicking Message', {
    profileUrl: target.profileUrl,
    profileSlug: target.profileSlug,
    profileName: target.profileName,
    ...getContextLogFields(browserContext)
  })

  await clickMessageButton(browserContext)
  const overlay = await waitForMatchingOverlay(browserContext, target)
  await focusMessageInput(browserContext, overlay.overlayId)

  log.info('Verified LinkedIn compose overlay recipient context', {
    profileUrl: target.profileUrl,
    recipientName: overlay.recipientName,
    recipientUrl: overlay.recipientUrl,
    overlayId: overlay.overlayId,
    ...getContextLogFields(browserContext)
  })

  return { browserContext, target, overlay }
}

/**
 * Send a LinkedIn message via browser automation + JavaScript injection.
 */
export async function sendLinkedInMessage(
  linkedinProfileUrl: string,
  message: string,
  dryRun: boolean
): Promise<SendResult> {
  const settings = getSettings()
  const isDryRun = dryRun || settings.globalDryRun
  const browserApp = sanitizeBrowserAppName(settings.browserApp)
  const profileUrl = normalizeLinkedInProfileUrl(linkedinProfileUrl)
  const profileSlug = extractLinkedInSlug(profileUrl)

  if (!profileUrl) {
    return {
      success: false,
      error: 'Invalid LinkedIn profile URL',
      dryRun: isDryRun
    }
  }

  return withAutomationLock('send', { profileUrl, profileSlug, dryRun: isDryRun }, async () => {
    try {
      const now = Date.now()
      const elapsed = now - lastSendTimestamp

      if (lastSendTimestamp > 0 && elapsed < settings.minIntervalBetweenSends) {
        const remainingSeconds = Math.ceil((settings.minIntervalBetweenSends - elapsed) / 1000)
        throw makeError(
          'rate_limited',
          `Rate limited: minimum interval not met (${remainingSeconds}s remaining)`,
          { profileUrl, remainingSeconds }
        )
      }

      log.info('Starting LinkedIn send automation', {
        profileUrl,
        profileSlug,
        browserApp,
        dryRun: isDryRun
      })

      const composeFlow = await openComposeFlow(browserApp, profileUrl, settings.pageLoadDelayMs)

      if (isDryRun) {
        lastSendTimestamp = Date.now()
        log.info('Dry run: verified compose flow without typing or sending', {
          profileUrl,
          profileSlug,
          ...getContextLogFields(composeFlow.browserContext),
          overlayId: composeFlow.overlay.overlayId
        })
        return { success: true, dryRun: true }
      }

      await setOverlayDraftMessage(composeFlow.browserContext, composeFlow.overlay.overlayId, message)
      await sleep(settings.sendDelayMs)
      await clickSendButton(composeFlow.browserContext, composeFlow.overlay.overlayId)
      await waitForSendConfirmation(composeFlow.browserContext, composeFlow.overlay.overlayId, message)

      lastSendTimestamp = Date.now()

      log.info('LinkedIn send automation confirmed success', {
        profileUrl,
        profileSlug,
        overlayId: composeFlow.overlay.overlayId,
        ...getContextLogFields(composeFlow.browserContext)
      })

      return { success: true, dryRun: false }
    } catch (error) {
      const classified = classifyLinkedInError(error)

      log.warn('LinkedIn send automation failed', {
        profileUrl,
        profileSlug,
        browserApp,
        code: classified.code,
        error: classified.message,
        ...(classified.details ?? {})
      })

      return { success: false, error: classified.message, dryRun: isDryRun }
    }
  })
}

/**
 * Check if the configured browser is accessible via AppleScript.
 */
export async function checkChromeAccess(): Promise<AccessibilityStatus> {
  try {
    const settings = getSettings()
    const browserApp = sanitizeBrowserAppName(settings.browserApp)
    await runAppleScript(`tell application ${toAppleScriptString(browserApp)} to return version`, 5000)
    return { granted: true }
  } catch (error) {
    const classified = classifyLinkedInError(error)
    return { granted: false, error: classified.message }
  }
}

/**
 * Open LinkedIn in the dedicated automation browser tab so the user can verify login state.
 */
export async function openLinkedInInChrome(): Promise<void> {
  const settings = getSettings()
  const browserApp = sanitizeBrowserAppName(settings.browserApp)

  await withAutomationLock('open_home', { browserApp }, async () => {
    await ensureBrowserRunning(browserApp)
    const context = await getOrCreateAutomationContext(browserApp)
    await navigateAutomationContextToUrl(context, 'https://www.linkedin.com')
    await waitForTabLoad(context, 'https://www.linkedin.com')

    log.info('Opened LinkedIn homepage in dedicated automation tab', getContextLogFields(context))
  })
}

export async function openLinkedInCompose(linkedinProfileUrl: string): Promise<void> {
  const settings = getSettings()
  const browserApp = sanitizeBrowserAppName(settings.browserApp)
  const profileUrl = normalizeLinkedInProfileUrl(linkedinProfileUrl)
  const profileSlug = extractLinkedInSlug(profileUrl)

  if (!profileUrl) {
    throw new Error('Invalid LinkedIn profile URL')
  }

  await withAutomationLock('compose', { profileUrl, profileSlug }, async () => {
    try {
      const composeFlow = await openComposeFlow(browserApp, profileUrl, settings.pageLoadDelayMs)

      log.info('Opened LinkedIn compose overlay without typing or sending', {
        profileUrl,
        profileSlug,
        overlayId: composeFlow.overlay.overlayId,
        ...getContextLogFields(composeFlow.browserContext)
      })
    } catch (error) {
      const classified = classifyLinkedInError(error)

      log.warn('LinkedIn compose automation failed', {
        profileUrl,
        profileSlug,
        browserApp,
        code: classified.code,
        error: classified.message,
        ...(classified.details ?? {})
      })

      throw classified
    }
  })
}
