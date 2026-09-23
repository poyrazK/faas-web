export function appNameError(value: string): string | undefined {
  if (!value) return 'Enter an app name.';
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(value)) {
    return 'Use 3–40 lowercase letters, numbers or dashes; start and end with a letter or number.';
  }
}
