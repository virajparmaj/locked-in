import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { api } from '@/lib/ipc'
import { ErrorAlert } from '@/components/ErrorAlert'
import { ShieldCheck, ShieldAlert, Sun, Moon, Monitor, Globe } from 'lucide-react'
import type { AccessibilityStatus } from '../../shared/types'

function DebouncedInput({
  value,
  onSave,
  ...props
}: {
  value: string
  onSave: (value: string) => void
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'>) {
  const [local, setLocal] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setLocal(value) }, [value])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setLocal(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onSave(v), 600)
  }, [onSave])

  const handleBlur = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    onSave(local)
  }, [local, onSave])

  return <Input value={local} onChange={handleChange} onBlur={handleBlur} {...props} />
}

export function Settings() {
  const { settings, loading, error, saveError, refresh, updateSetting, clearSaveError } = useSettings()
  const [chromeAccess, setChromeAccess] = useState<AccessibilityStatus | null>(null)
  const [checkingChrome, setCheckingChrome] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => { checkChrome() }, [])

  const handleSettingUpdate = useCallback((key: string, value: string) => {
    setActionError(null)
    clearSaveError()
    void updateSetting(key, value)
  }, [clearSaveError, updateSetting])

  async function checkChrome() {
    setCheckingChrome(true)
    setActionError(null)
    try {
      const status = await api.checkChromeAccess()
      setChromeAccess(status)
    } catch {
      setChromeAccess({ granted: false, error: 'Check failed' })
    } finally {
      setCheckingChrome(false)
    }
  }

  async function openLinkedIn() {
    setActionError(null)
    try {
      await api.openLinkedInInChrome()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setActionError(msg)
    }
  }

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading settings...</div>
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorAlert error={error} onRetry={refresh} />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-8 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">Configure LockedIn&apos;s local browser automation for LinkedIn</p>
      </div>

      {(saveError || actionError) && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 space-y-1">
          <p className="text-sm font-medium text-destructive">Settings action failed</p>
          <p className="text-xs text-muted-foreground font-mono break-all">{saveError || actionError}</p>
        </div>
      )}

      {/* Browser Automation Access */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Browser Automation</h3>
        <div className="rounded-lg border p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {chromeAccess?.granted ? (
              <ShieldCheck className="h-5 w-5 text-green-500" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-yellow-500" />
            )}
            <div>
              <p className="text-sm font-medium">
                {chromeAccess?.granted ? 'Browser automation ready' : 'Browser automation needs attention'}
              </p>
              <p className="text-xs text-muted-foreground">
                {chromeAccess?.granted
                  ? 'LockedIn can control your configured Chromium-compatible browser via AppleScript.'
                  : chromeAccess?.error || 'Make sure your configured Chromium-compatible browser is installed, running, and allowed for AppleScript automation.'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={checkChrome} disabled={checkingChrome}>
              {checkingChrome ? 'Checking...' : 'Re-check'}
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openLinkedIn}>
            <Globe className="h-3.5 w-3.5 mr-1.5" />
            Open LinkedIn in Browser
          </Button>
          <p className="text-xs text-muted-foreground self-center">
            Verify you&apos;re logged in within the configured browser
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          LockedIn is browser automation, not a native LinkedIn integration. Google Chrome is the default/tested browser, and only Chromium-style AppleScript control is expected to work reliably.
        </p>
      </section>

      {/* Global Dry Run */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Message Sending</h3>
        <div className="flex items-center justify-between">
          <div>
            <Label>Global Dry Run</Label>
            <p className="text-xs text-muted-foreground">When enabled, no messages will actually be sent</p>
          </div>
          <Switch
            checked={settings.globalDryRun}
            onCheckedChange={(checked) => handleSettingUpdate('global_dry_run', checked ? '1' : '0')}
          />
        </div>
      </section>

      {/* Delays */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Timing</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Page Load Delay (ms)</Label>
            <DebouncedInput
              type="number"
              value={String(settings.pageLoadDelayMs)}
              onSave={(v) => handleSettingUpdate('page_load_delay_ms', v)}
              min="1000"
              max="15000"
            />
            <p className="text-[11px] text-muted-foreground">Wait for LinkedIn SPA to render</p>
          </div>
          <div className="space-y-2">
            <Label>Send Delay (ms)</Label>
            <DebouncedInput
              type="number"
              value={String(settings.sendDelayMs)}
              onSave={(v) => handleSettingUpdate('send_delay_ms', v)}
              min="1000"
              max="15000"
            />
            <p className="text-[11px] text-muted-foreground">Wait after typing before clicking send</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Min Interval Between Sends (ms)</Label>
          <DebouncedInput
            type="number"
            value={String(settings.minIntervalBetweenSends)}
            onSave={(v) => handleSettingUpdate('min_interval_between_sends', v)}
            min="10000"
            max="300000"
          />
          <p className="text-[11px] text-muted-foreground">Rate limit to avoid LinkedIn throttling (default: 60s)</p>
        </div>
      </section>

      {/* Retries */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Retries</h3>
        <div className="space-y-2">
          <Label>Max Retries</Label>
          <DebouncedInput
            type="number"
            value={String(settings.maxRetries)}
            onSave={(v) => handleSettingUpdate('max_retries', v)}
            min="0"
            max="5"
          />
        </div>
      </section>

      {/* Browser */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Browser</h3>
        <div className="space-y-2">
          <Label>Chromium-Compatible Browser App Name</Label>
          <DebouncedInput
            value={settings.browserApp}
            onSave={(v) => handleSettingUpdate('browser_app', v)}
            placeholder="Google Chrome"
          />
          <p className="text-[11px] text-muted-foreground">
            Enter the macOS app name used for browser automation. Google Chrome is the default/tested option, and only browsers with Chrome-style AppleScript tab control are expected to work reliably.
          </p>
        </div>
      </section>

      {/* Default Message Template */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Templates</h3>
        <div className="space-y-2">
          <Label>Default Message Template</Label>
          <Textarea
            placeholder="Hi {name}, ..."
            rows={3}
            value={settings.defaultMessageTemplate}
            onChange={(e) => handleSettingUpdate('default_message_template', e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">Pre-fill new schedule messages with this template</p>
        </div>
      </section>

      {/* System */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">System</h3>
        <div className="flex items-center justify-between">
          <div>
            <Label>Open at Login</Label>
            <p className="text-xs text-muted-foreground">Start LockedIn when you log in to macOS</p>
          </div>
          <Switch
            checked={settings.openAtLogin}
            onCheckedChange={(checked) => handleSettingUpdate('open_at_login', checked ? '1' : '0')}
          />
        </div>
      </section>

      {/* Theme */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Appearance</h3>
        <div className="flex gap-2">
          {[
            { value: 'system', icon: Monitor, label: 'System' },
            { value: 'light', icon: Sun, label: 'Light' },
            { value: 'dark', icon: Moon, label: 'Dark' }
          ].map(({ value, icon: Icon, label }) => (
            <Button
              key={value}
              variant={settings.theme === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleSettingUpdate('theme', value)}
            >
              <Icon className="h-3.5 w-3.5 mr-1.5" />
              {label}
            </Button>
          ))}
        </div>
      </section>
    </div>
  )
}
