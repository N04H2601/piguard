const hasUppercase = /[A-Z]/;
const hasLowercase = /[a-z]/;
const hasDigit = /\d/;
const hasSpecial = /[^A-Za-z0-9]/;

export const PASSWORD_POLICY_HINT = 'Use at least 8 characters with uppercase, lowercase, number, and special character.';

export function getPasswordPolicyError(password: string): string | null {
  if (password.length < 8) return PASSWORD_POLICY_HINT;
  if (!hasUppercase.test(password)) return PASSWORD_POLICY_HINT;
  if (!hasLowercase.test(password)) return PASSWORD_POLICY_HINT;
  if (!hasDigit.test(password)) return PASSWORD_POLICY_HINT;
  if (!hasSpecial.test(password)) return PASSWORD_POLICY_HINT;
  return null;
}
