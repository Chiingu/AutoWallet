import { useEffect, useEffectEvent, useRef } from 'react'
import type { RefObject } from 'react'

export function useDismissibleLayer(open: boolean, onDismiss: () => void, triggerRef?: RefObject<HTMLElement | null>) {
  const layerRef = useRef<HTMLDivElement>(null)
  const dismiss = useEffectEvent(onDismiss)
  const isInside = useEffectEvent((target: Node) => layerRef.current?.contains(target) || triggerRef?.current?.contains(target))

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!isInside(event.target as Node)) dismiss() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  return layerRef
}
