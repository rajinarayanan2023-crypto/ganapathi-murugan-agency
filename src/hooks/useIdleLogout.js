import { useEffect, useRef } from 'react'

// Any of these counts as "the user is here" — mouse, keyboard, touch, and
// scroll/wheel activity all reset the idle clock. Passive listeners since
// none of them ever need to preventDefault.
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel']

// Fires onIdle once after timeoutMs with no activity, then re-arms itself —
// this isn't a one-shot timer, it keeps watching for the next idle stretch
// after a logout (or whatever onIdle does) resets things.
export default function useIdleLogout(timeoutMs, onIdle, enabled = true) {
  const timerRef = useRef(null)
  // Ref rather than a dep on onIdle itself — onIdle is a fresh closure every
  // render (it captures navigate/logout/t), and resetting the whole idle
  // timer on every render would mean it never actually fires. This way the
  // timer's lifecycle is independent of re-renders; it always calls
  // whatever the latest onIdle happens to be.
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useEffect(() => {
    if (!enabled) return undefined

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => onIdleRef.current(), timeoutMs)
    }

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }))
    resetTimer()

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimer))
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [timeoutMs, enabled])
}
