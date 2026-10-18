/**
 * PasswordStrength component — the signup password meter.
 *
 * The scoring rules (from the component):
 *   +1 length >= 8
 *   +1 has BOTH upper and lower case
 *   +1 has a digit
 *   +1 has a non-alphanumeric char OR length >= 12
 * Score 0..4 -> label: 1 Weak, 2 Fair, 3 Good, 4 Strong, 0 nothing.
 *
 * Each test: SCENARIO (what password is typed) / EXPECTED (meter state).
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { PasswordStrength } from '../src/components/common/PasswordStrength'
import { translations as t } from '../src/i18n'
// (auto-cleanup lives in tests/setup.ts)

const gray = 'bg-[#DDE3EA]' // inactive segment color

// The 4 segments live in a grid div that is aria-hidden="true"; query the
// meter by its requirement row (always rendered) and read its sibling.
function activeSegments(password: string): number {
  const { container } = render(<PasswordStrength password={password} t={t} />)
  const grid = container.querySelector('div.grid.grid-cols-4')
  if (!grid) throw new Error('meter grid not found')
  const segments = Array.from(grid.children) as HTMLElement[]
  return segments.filter((s) => !s.className.includes(gray)).length
}

function shownLabel(password: string): string {
  const { container } = render(<PasswordStrength password={password} t={t} />)
  return container.textContent ?? ''
}

describe('PIN: password strength meter', () => {
  it('PIN: empty password -> 0 active segments, no label', () => {
    // SCENARIO: user has not typed anything yet.
    // EXPECTED: no segment colored, no strength label shown.
    expect(activeSegments('')).toBe(0)
    expect(shownLabel('')).not.toContain(t.pwStrengthWeak)
  })

  it('PIN: password under 8 chars -> 0 segments, no label (the meter ignores it; validation handles it)', () => {
    // SCENARIO: "abc" — 3 chars. NONE of the scoring rules can fire
    //           (the cheapest rule requires length >= 8).
    // EXPECTED: 0/4 colored, NO strength label — short passwords are
    //           rejected by the separate pwTooShort validation, the
    //           meter deliberately stays silent about them.
    expect(activeSegments('abc')).toBe(0)
    expect(shownLabel('abc')).not.toContain(t.pwStrengthWeak)
  })

  it('PIN: 8-char lowercase is STILL Weak (length alone is not enough)', () => {
    // SCENARIO: "password" — 8 chars but no upper, digit, or symbol.
    // EXPECTED: 1/4 (length +1 only), label Weak — the QA fact the meter
    //           teaches users: length is necessary, not sufficient.
    expect(activeSegments('password')).toBe(1)
    expect(shownLabel('password')).toContain(t.pwStrengthWeak)
  })

  it('PIN: mixed case + digit -> 3 segments, Good', () => {
    // SCENARIO: "Password1" — 9 chars, mixed case, digit.
    // EXPECTED: 3/4 colored, label Good.
    expect(activeSegments('Password1')).toBe(3)
    expect(shownLabel('Password1')).toContain(t.pwStrengthGood)
  })

  it('PIN: mixed case + digit + symbol -> 4 segments, Strong', () => {
    // SCENARIO: "Password1!" — all four rules.
    // EXPECTED: 4/4 colored, label Strong.
    expect(activeSegments('Password1!')).toBe(4)
    expect(shownLabel('Password1!')).toContain(t.pwStrengthStrong)
  })

  it('PIN: 12-char lowercase -> 2 segments, Fair (the length>=12 fallback rule)', () => {
    // SCENARIO: "abcdefghijkl" — 12 chars, no variety.
    // EXPECTED: 2/4 (length +1, the >=12 fallback +1), label Fair.
    expect(activeSegments('abcdefghijkl')).toBe(2)
    expect(shownLabel('abcdefghijkl')).toContain(t.pwStrengthFair)
  })
})
