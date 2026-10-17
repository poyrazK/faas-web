export function publicBuildURLKeyError(key: string): string {
  return /^[A-Z][A-Z0-9_]{0,127}$/.test(key) &&
    /^(VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_|NUXT_PUBLIC_|GATSBY_).+_URL$/.test(key)
    ? ''
    : 'Use a frontend variable such as VITE_API_URL or NEXT_PUBLIC_API_URL ending in _URL.';
}

export function publicBuildURLError(value: string): string {
  const issue = 'Use a public HTTPS base URL without credentials, query parameters or fragments.';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      value.length > 2048 ||
      value.trim() !== value ||
      !value.startsWith('https://') ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      value.includes('?') ||
      value.includes('#') ||
      /[\s\\]/.test(value) ||
      !host.includes('.') ||
      host.endsWith('.') ||
      /(^|\.)(localhost|internal|local|test)$/.test(host) ||
      /^[\d.]+$/.test(host) ||
      host.includes(':') ||
      url.port ||
      !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    )
      return issue;
    return '';
  } catch {
    return issue;
  }
}
