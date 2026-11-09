/** Native screen readers use the accessibility role and state. Web uses role and aria-checked. */
export function checkboxA11y(checked: boolean, disabled = false) {
  return {
    accessibilityRole: 'checkbox' as const,
    accessibilityState: { checked, disabled },
    role: 'checkbox' as const,
    'aria-checked': checked,
    'aria-disabled': disabled,
  };
}
