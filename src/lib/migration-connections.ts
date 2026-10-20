export function migrationConnectionKeyError(key: string): string {
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(key) || key === 'PORT' || /^(GREGALE_|FAAS_)/.test(key))
    return 'Use a customer runtime variable name with uppercase letters, digits and underscores.';
  if (/^(VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_|NUXT_PUBLIC_|GATSBY_)/.test(key))
    return 'Browser and build-time variables need a public URL configured separately.';
  return '';
}
