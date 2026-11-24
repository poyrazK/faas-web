export function indexNowKey(value = '') {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(value)) {
    throw new Error('INDEXNOW_KEY must contain 8–128 letters, digits, or hyphens.');
  }
  return value;
}
