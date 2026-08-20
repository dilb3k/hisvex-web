'use client'

import { useEffect, useRef } from 'react'

/**
 * Closes the top-most open modal/overlay on Escape, mirroring the
 * click-outside-to-close behavior every modal's backdrop already provides in
 * this app (none of them previously handled Escape at all).
 *
 * Pass layers ordered from topmost (checked first) to bottom - only the
 * first *active* layer's closer runs, so e.g. a PIN-verify sheet stacked on
 * top of a delete-confirm dialog closes just the PIN sheet on the first
 * Escape press, not both at once, matching how a real topmost-dismiss would
 * behave.
 */
export function useEscapeToClose(layers: Array<[boolean, () => void]>) {
  const activeCloser = layers.find(([active]) => active)?.[1]
  // Read the latest closer through a ref rather than depending on it
  // directly - the callers pass a fresh inline arrow function every render,
  // so depending on it would tear down and re-attach the window listener on
  // every re-render (e.g. every keystroke while typing in an open modal's
  // input), not just when a layer actually opens/closes.
  const closerRef = useRef(activeCloser)
  closerRef.current = activeCloser
  const hasActiveLayer = !!activeCloser

  useEffect(() => {
    if (!hasActiveLayer) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closerRef.current?.()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hasActiveLayer])
}
