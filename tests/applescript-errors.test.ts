import { describe, expect, it } from 'vitest'
import { classifyAppleScriptError } from '../electron/utils/applescript'

describe('classifyAppleScriptError', () => {
  it('maps assistive access errors to an Accessibility permission message', () => {
    const error = classifyAppleScriptError(
      'osascript is not allowed assistive access. (-25211)'
    )

    expect(error.message).toContain('Accessibility permission')
    expect(error.message).toContain('System Settings')
  })

  it('maps Apple Events authorization errors to an Automation permission message', () => {
    const error = classifyAppleScriptError(
      'Not authorized to send Apple events to Google Chrome. (-1743)'
    )

    expect(error.message).toContain('Automation permission')
    expect(error.message).toContain('System Settings')
  })

  it('maps Chrome JavaScript-from-Apple-Events being off to an actionable message', () => {
    const error = classifyAppleScriptError(
      'Google Chrome got an error: Executing JavaScript through AppleScript is turned off. ' +
      'To turn it on, from the menu bar, go to View > Developer > Allow JavaScript from Apple Events. ' +
      'For more information: https://support.google.com/chrome/?p=applescript (12)'
    )

    expect(error.message).toContain('Allow JavaScript from Apple Events')
    expect(error.message).toContain('View > Developer')
  })

  it('passes through unrecognized errors unchanged', () => {
    const error = classifyAppleScriptError('Some unrelated osascript failure (-1728)')

    expect(error.message).toBe('Some unrelated osascript failure (-1728)')
  })

  it('falls back to a generic message when stderr is empty', () => {
    const error = classifyAppleScriptError('   ')

    expect(error.message).toBe('AppleScript execution failed')
  })
})
