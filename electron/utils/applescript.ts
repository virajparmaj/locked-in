import { execFile } from 'child_process'

const ACCESSIBILITY_ERROR_RE = /not allowed assistive access|1002/i
const AUTOMATION_PERMISSION_RE = /not authorized to send apple events|automation permission|not permitted to send apple events|-1743/i

function classifyAppleScriptError(rawMessage: string): Error {
  const message = rawMessage.trim() || 'AppleScript execution failed'

  if (ACCESSIBILITY_ERROR_RE.test(message)) {
    return new Error(
      'Accessibility permission not granted. Go to System Settings > Privacy & Security > Accessibility and add this app.'
    )
  }

  if (AUTOMATION_PERMISSION_RE.test(message)) {
    return new Error(
      'Accessibility permission not granted for browser automation, or Automation permission was denied. Allow this app to control your browser in System Settings > Privacy & Security.'
    )
  }

  return new Error(message)
}

export function toAppleScriptString(value: string): string {
  return `"${value
    .replace(/\r/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')}"`
}

/**
 * Execute an AppleScript string via osascript.
 * Returns stdout on success, throws on failure.
 */
export function runAppleScript(script: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      'osascript',
      ['-e', script],
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          reject(classifyAppleScriptError(stderr || error.message))
        } else {
          resolve(stdout.trim())
        }
      }
    )

    // Safety timeout kill
    setTimeout(() => {
      proc.kill()
    }, timeoutMs + 1000)
  })
}

/**
 * Run a shell command (like `open` for URL schemes).
 */
export function runCommand(command: string, args: string[], timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}
