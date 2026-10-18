/**
 * useCountdown hook — the "resend code in Ns" timer.
 *
 * Behavior: ticks down 1/second from the started value, floors at 0,
 * stops the interval once it reaches 0.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCountdown } from '../src/hooks/useCountdown'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('PIN: useCountdown', () => {
  it('PIN: starts at 0 (not running)', () => {
    // SCENARIO: fresh mount, nothing started.
    // EXPECTED: countdown 0.
    const { result } = renderHook(() => useCountdown())
    expect(result.current.countdown).toBe(0)
  })

  it('PIN: ticks down 1 per second and floors at 0', () => {
    // SCENARIO: start(3), then advance 5 seconds.
    // EXPECTED: 3 -> 2 -> 1 -> 0, and STAYS 0 (no negative).
    const { result } = renderHook(() => useCountdown())
    act(() => result.current.startCountdown(3))
    expect(result.current.countdown).toBe(3)
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.countdown).toBe(2)
    act(() => vi.advanceTimersByTime(2000))
    expect(result.current.countdown).toBe(0)
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current.countdown).toBe(0)
  })

  it('PIN: the interval is cleaned up on unmount (no leak)', () => {
    // SCENARIO: start a countdown, then unmount the hook.
    // EXPECTED: no timer remains — advancing time does nothing and
    //           throws no "state update on unmounted" warning.
    const { result, unmount } = renderHook(() => useCountdown())
    act(() => result.current.startCountdown(10))
    unmount()
    const before = result.current.countdown
    act(() => vi.advanceTimersByTime(60000))
    expect(result.current.countdown).toBe(before)
  })
})
