/**
 * The password rule for accounts (specs/product/accounts.md, "Passwords"). Pure: the sign-up form shows the same
 * checks live that the server enforces before calling Supabase.
 *
 * At least 10 characters, and either three of the four kinds (lowercase, uppercase, digits, symbols) or a passphrase
 * of 16 or more. Never the email's name part, and never one of the passwords everyone tries first.
 */
export const PASSWORD_MIN = 10;
const PASSPHRASE_MIN = 16;

const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "qwerty", "qwerty123", "qwertyuiop",
  "123456789", "1234567890", "12345678910", "0123456789", "iloveyou", "letmein", "welcome1", "welcome123", "admin123",
  "football", "baseball", "basketball", "princess", "sunshine", "starwars", "dragon123", "monkey123", "abc12345",
  "abcdefghij", "1q2w3e4r5t", "1qaz2wsx3edc", "zaq12wsx", "trustno1", "college123", "student123",
]);

export function passwordKinds(pw: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
}

/** What's wrong with a password, in plain words; empty when it's acceptable. */
export function passwordProblems(pw: string, email = ""): string[] {
  const problems: string[] = [];
  if (pw.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters.`);
  else if (pw.length < PASSPHRASE_MIN && passwordKinds(pw) < 3)
    problems.push(`Mix at least three of: lowercase, uppercase, numbers, symbols. Or use a longer passphrase (${PASSPHRASE_MIN}+ characters).`);
  if (pw.length > 72) problems.push("Use 72 characters or fewer.");
  const name = email.split("@")[0]?.toLowerCase() ?? "";
  const lower = pw.toLowerCase();
  if (name.length >= 3 && lower.includes(name)) problems.push("Don't use your email name in it.");
  if (COMMON.has(lower) || /^(.)\1+$/.test(pw)) problems.push("That one is too easy to guess.");
  return problems;
}

/** For the meter under the field: 0 empty, 1 weak, 2 okay, 3 strong. */
export function passwordStrength(pw: string, email = ""): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  if (passwordProblems(pw, email).length) return 1;
  return pw.length >= PASSPHRASE_MIN || (pw.length >= 12 && passwordKinds(pw) === 4) ? 3 : 2;
}
