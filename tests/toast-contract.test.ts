import { describe, expectTypeOf, it } from 'vitest'
import type { ToastInput } from '@/components/ui/toast'
import { useToast } from '@/components/ui/toast'

describe('toast contract', () => {
  it('matches the object payload used across renderer pages', () => {
    expectTypeOf<Parameters<ReturnType<typeof useToast>['toast']>>()
      .toEqualTypeOf<[ToastInput]>()

    expectTypeOf<ToastInput>().toMatchTypeOf<{
      description?: string
      title: string
      variant?: 'default' | 'success' | 'info' | 'destructive'
    }>()
  })
})
