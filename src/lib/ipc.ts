const IPC_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`IPC call "${label}" timed out after ${IPC_TIMEOUT_MS / 1000}s — main process may be unresponsive`)),
      IPC_TIMEOUT_MS
    )
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

type ElectronAPI = typeof window.api

export const api = new Proxy(window.api, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver)
    if (typeof value !== 'function') return value

    // Don't wrap event listeners (they return unsubscribe functions, not promises)
    if (typeof prop === 'string' && prop.startsWith('on')) return value

    return (...args: unknown[]) => {
      const result = value.apply(target, args)
      if (result && typeof result.then === 'function') {
        return withTimeout(result, String(prop))
      }
      return result
    }
  }
}) as ElectronAPI
