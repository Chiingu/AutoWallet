/**
 * OTPInput component — the 2FA/verify-email 6-digit code box.
 *
 * Behavior under test (from the component):
 *   - one char per box, digits only, non-digits ignored
 *   - typing auto-advances focus to the next box
 *   - Backspace on an empty box moves focus BACK
 *   - paste of a 6-digit string fills everything and fires onComplete
 *   - onComplete fires exactly when all 6 digits are present
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OTPInput } from '../src/components/common/OTPInput'
// (auto-cleanup lives in tests/setup.ts)

function renderOtp(value = '', onChange = vi.fn(), onComplete?: (v: string) => void) {
  const utils = render(
    <OTPInput value={value} onChange={onChange} onComplete={onComplete} />,
  )
  const boxes = [
    screen.getByLabelText('Digit 1 of 6'),
    screen.getByLabelText('Digit 2 of 6'),
    screen.getByLabelText('Digit 3 of 6'),
    screen.getByLabelText('Digit 4 of 6'),
    screen.getByLabelText('Digit 5 of 6'),
    screen.getByLabelText('Digit 6 of 6'),
  ]
  return { ...utils, boxes, onChange, onComplete: onComplete ?? vi.fn() }
}

describe('PIN: OTP input', () => {
  it('PIN: renders 6 digit boxes inside a labeled group', () => {
    // SCENARIO: the 2FA screen mounts.
    // EXPECTED: 6 inputs, each labeled, inside the a11y group.
    const { boxes } = renderOtp()
    expect(boxes).toHaveLength(6)
    expect(screen.getByRole('group', { name: '6-digit verification code' })).toBeInTheDocument()
  })

  it('PIN: typing a digit fills the box and moves focus to the next one', async () => {
    // SCENARIO: user types "5" into the first box.
    // EXPECTED: box 1 shows 5, focus is now on Digit 2.
    const user = userEvent.setup()
    const { boxes, onChange } = renderOtp()
    await user.type(boxes[0], '5')
    expect(onChange).toHaveBeenLastCalledWith('5')
    expect(document.activeElement).toBe(boxes[1])
  })

  it('PIN: non-digit characters are ignored', async () => {
    // SCENARIO: user types "a" into the first box.
    // EXPECTED: the box stays empty (only digits are accepted).
    const user = userEvent.setup()
    const { boxes, onChange } = renderOtp()
    await user.type(boxes[0], 'a')
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(boxes[0]).toHaveValue('')
  })

  it('PIN: completing all 6 digits fires onComplete with the full code', async () => {
    // SCENARIO: user types 1..6 across the boxes.
    // EXPECTED: onComplete("123456") — exactly once.
    const user = userEvent.setup()
    const onComplete = vi.fn()
    let value = ''
    const { rerender } = render(
      <OTPInput value={value} onChange={(v) => { value = v }} onComplete={onComplete} />,
    )
    const getBoxes = () => [
      screen.getByLabelText('Digit 1 of 6'), screen.getByLabelText('Digit 2 of 6'),
      screen.getByLabelText('Digit 3 of 6'), screen.getByLabelText('Digit 4 of 6'),
      screen.getByLabelText('Digit 5 of 6'), screen.getByLabelText('Digit 6 of 6'),
    ]
    for (const d of ['1', '2', '3', '4', '5', '6']) {
      await user.type(getBoxes()[value.length], d)
      rerender(<OTPInput value={value} onChange={(v) => { value = v }} onComplete={onComplete} />)
    }
    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  it('PIN: Backspace on an empty box moves focus BACK', async () => {
    // SCENARIO: focus sits on Digit 3, box empty; user presses Backspace.
    // EXPECTED: focus moves back to Digit 2 (corrective navigation).
    const user = userEvent.setup()
    const { boxes } = renderOtp('12')
    boxes[2].focus()
    await user.keyboard('{Backspace}')
    expect(document.activeElement).toBe(boxes[1])
  })

  it('PIN: pasting a 6-digit code fills all boxes and fires onComplete once', () => {
    // SCENARIO: the user pastes "123456" from their authenticator app.
    // EXPECTED: onChange("123456"), onComplete("123456"), focus on Digit 6.
    const onChange = vi.fn()
    const onComplete = vi.fn()
    renderOtp('', onChange, onComplete)
    fireEvent.paste(screen.getByRole('group', { name: '6-digit verification code' }), {
      clipboardData: { getData: () => '123456' },
    })
    expect(onChange).toHaveBeenCalledWith('123456')
    expect(onComplete).toHaveBeenCalledWith('123456')
  })
})
