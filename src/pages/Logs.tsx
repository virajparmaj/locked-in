import { useLogs } from '@/hooks/useLogs'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { ScrollText, Trash2 } from 'lucide-react'
import { formatDateTime, formatDuration, truncate } from '@/lib/utils'
import { useState } from 'react'

export function Logs() {
  const { logs, loading, error, refresh, clearLogs } = useLogs()
  const [confirmClear, setConfirmClear] = useState(false)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Activity Log</h2>
          <p className="text-sm text-muted-foreground">{logs.length} entries</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => clearLogs(30)}>
            Clear 30d+
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)} className="text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Clear All
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-12 rounded border bg-card animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <ErrorAlert error={error} onRetry={refresh} />
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ScrollText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No activity yet</p>
          <p className="text-sm">Logs will appear here after schedules execute</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Contact</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Message</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Fired At</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Duration</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Retry</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-2">
                    <StatusBadge status={log.status} />
                  </td>
                  <td className="px-4 py-2">
                    <span className="truncate block max-w-[120px]">
                      {log.contactName || log.linkedinSlug || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-muted-foreground truncate block max-w-[200px]">
                      {log.messagePreview ? truncate(log.messagePreview, 50) : '-'}
                    </span>
                    {log.errorMessage && (
                      <span className="text-xs text-destructive block truncate max-w-[200px]">
                        {log.errorMessage}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">
                    {formatDateTime(log.firedAt)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">
                    {formatDuration(log.executionDuration)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">
                    {log.retryAttempt ? `#${log.retryAttempt}` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background border rounded-lg p-6 max-w-sm space-y-4">
            <h3 className="font-semibold">Clear All Logs?</h3>
            <p className="text-sm text-muted-foreground">This will permanently delete all activity logs.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmClear(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => { clearLogs(); setConfirmClear(false) }}>Clear All</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
