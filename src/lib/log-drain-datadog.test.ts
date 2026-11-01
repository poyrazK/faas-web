import { describe, expect, it } from 'vitest';
import {
  DATADOG_SITES,
  datadogAuthHeader,
  datadogIntakeUrl,
  datadogSiteOf,
} from './log-drain-datadog';

describe('Datadog log drain helpers', () => {
  it('offers exactly the sites apid accepts (faas pkg/api/datadog.go)', () => {
    expect(DATADOG_SITES.map((s) => s.site)).toEqual(['us1', 'us3', 'us5', 'eu1', 'ap1']);
  });

  it('derives the logs intake from the site, never from free text', () => {
    expect(datadogIntakeUrl('us1')).toBe('https://http-intake.logs.datadoghq.com/api/v2/logs');
    expect(datadogIntakeUrl('eu1')).toBe('https://http-intake.logs.datadoghq.eu/api/v2/logs');
    expect(datadogIntakeUrl('ap1')).toBe('https://http-intake.logs.ap1.datadoghq.com/api/v2/logs');
  });

  it('reads the site back from a stored intake URL', () => {
    expect(datadogSiteOf('https://http-intake.logs.us5.datadoghq.com/api/v2/logs')).toBe('us5');
    expect(datadogSiteOf('https://logs.example.com/ingest')).toBeUndefined();
  });

  it('sends the API key as the one header Datadog authenticates with', () => {
    expect(datadogAuthHeader('  abc123  ')).toBe('DD-API-KEY: abc123');
  });
});
