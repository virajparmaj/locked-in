import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorAlertProps {
  error: string
  onRetry?: () => void
}

export function ErrorAlert({ error, onRetry }: ErrorAlertProps) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-destructive">Failed to load data</p>
          <p className="text-xs text-muted-foreground font-mono break-all">{error}</p>
        </div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="ml-8">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      )}
    </div>
  )
}
