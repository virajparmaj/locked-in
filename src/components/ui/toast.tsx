import * as React from 'react'
import { createContext, useContext, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'

export type ToastVariant = 'default' | 'success' | 'info' | 'destructive'

export interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
}

interface ToastRecord extends ToastInput {
  id: number
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (input: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let toastId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])

  const toast = useCallback((input: ToastInput) => {
    const id = ++toastId
    const variant = input.variant ?? 'default'
    setToasts((prev) => [...prev, { id, ...input, variant }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4000)
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const variantStyles: Record<ToastVariant, string> = {
  default: 'border-border bg-card text-card-foreground',
  success: 'border-green-200 bg-green-50 text-green-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
  destructive: 'border-red-200 bg-red-50 text-red-800'
}

const variantIcons: Record<ToastVariant, React.ReactNode> = {
  default: null,
  success: <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />,
  info: <Info className="h-4 w-4 text-blue-600 shrink-0" />,
  destructive: <XCircle className="h-4 w-4 text-red-600 shrink-0" />
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg animate-slide-in-right min-w-[280px] max-w-[400px]',
        variantStyles[toast.variant]
      )}
    >
      {variantIcons[toast.variant]}
      <div className="flex-1 space-y-1">
        <p className="font-medium leading-none">{toast.title}</p>
        {toast.description && (
          <p className="text-xs opacity-90">{toast.description}</p>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss toast"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within ToastProvider')
  return context
}
