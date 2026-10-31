/**
 * The runtime's IANA zones, UTC first, when it can list them. Free text works
 * either way: the list is only a suggestion source for a `<datalist>`, and the
 * API is the judge of a zone it cannot load.
 */
export const TIME_ZONES: readonly string[] =
  typeof Intl.supportedValuesOf === 'function'
    ? ['UTC', ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'UTC')]
    : [];
