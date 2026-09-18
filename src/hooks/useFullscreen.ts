import { useCallback, useEffect, useRef, useState } from 'react'

export function useFullscreen(onError: (message: string) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const pendingRef = useRef(false)
  const mountedRef = useRef(false)
  const onErrorRef = useRef(onError)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [supported, setSupported] = useState(false)
  const [pending, setPending] = useState(false)
  onErrorRef.current = onError

  useEffect(() => {
    mountedRef.current = true
    setSupported(Boolean(
      document.fullscreenEnabled
      && typeof ref.current?.requestFullscreen === 'function'
      && typeof document.exitFullscreen === 'function',
    ))

    const syncFullscreen = () => {
      setIsFullscreen(ref.current !== null && document.fullscreenElement === ref.current)
    }
    syncFullscreen()
    document.addEventListener('fullscreenchange', syncFullscreen)

    return () => {
      mountedRef.current = false
      document.removeEventListener('fullscreenchange', syncFullscreen)
    }
  }, [])

  const toggle = useCallback(async () => {
    const element = ref.current
    if (!element || !supported || pendingRef.current) return

    // React の再描画前にもう一度押されても、同時に切り替えを要求しない。
    pendingRef.current = true
    setPending(true)
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen()
      else await element.requestFullscreen()
    } catch {
      if (mountedRef.current) {
        onErrorRef.current('全画面表示を切り替えられませんでした。もう一度お試しください。')
      }
    } finally {
      pendingRef.current = false
      if (mountedRef.current) {
        setIsFullscreen(document.fullscreenElement === element)
        setPending(false)
      }
    }
  }, [supported])

  return { ref, isFullscreen, supported, pending, toggle }
}
