/**
 * The `datadog` log drain kind (faas ADR-752). apid accepts only the logs
 * intake of one of a closed set of Datadog sites, so a customer's API key is
 * only ever sent to Datadog; the form picks a site and derives the URL rather
 * than taking one (faas pkg/api/datadog.go, handlers_log_drains.go:41).
 */
export const DATADOG_SITES = [
  { site: 'us1', domain: 'datadoghq.com' },
  { site: 'us3', domain: 'us3.datadoghq.com' },
  { site: 'us5', domain: 'us5.datadoghq.com' },
  { site: 'eu1', domain: 'datadoghq.eu' },
  { site: 'ap1', domain: 'ap1.datadoghq.com' },
] as const;
export type DatadogSite = (typeof DATADOG_SITES)[number]['site'];

export function datadogIntakeUrl(site: DatadogSite): string {
  const domain = DATADOG_SITES.find((s) => s.site === site)?.domain ?? DATADOG_SITES[0].domain;
  return `https://http-intake.logs.${domain}/api/v2/logs`;
}

/** The site a stored intake URL belongs to, or undefined for any other URL. */
export function datadogSiteOf(url: string): DatadogSite | undefined {
  return DATADOG_SITES.find((s) => datadogIntakeUrl(s.site) === url)?.site;
}

/** Datadog's intakes authenticate with this one header. */
export function datadogAuthHeader(apiKey: string): string {
  return `DD-API-KEY: ${apiKey.trim()}`;
}
