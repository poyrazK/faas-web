import type { OutboundAIUsage, OutboundIntegration, OutboundUsage } from './api/outbound';
import { meterTone } from './limits';
import { formatCents } from './money';

/**
 * Spending limits › Integrations and AI: each outbound integration's limits as
 * plain rows. Pure, so every case can be pinned. A meter appears only where
 * faas reports the use; a limit without reported use is a sentence alone.
 */
export interface IntegrationLimitRow {
  key: 'requests' | 'tokens' | 'cost-day' | 'cost-month' | 'ai-none';
  name: string;
  sentence: string;
  meter?: { used: number; limit: number; label: string };
}

const count = (n: number) => n.toLocaleString('en');
const money = (millicents: number) => formatCents(Math.round(millicents / 1000));
const set = (n: number | null | undefined): n is number => n != null;

export function integrationLimitRows(
  integration: OutboundIntegration,
  usage?: OutboundUsage,
  ai?: OutboundAIUsage
): IntegrationLimitRow[] {
  const rows: IntegrationLimitRow[] = [];
  const requests = usage ? usage.daily_request_limit : integration.daily_request_limit;
  rows.push(
    set(requests)
      ? {
          key: 'requests',
          name: 'Requests a day',
          sentence: `Requests stop at ${count(requests)} a day; the gateway answers 429 until midnight UTC.`,
          ...(usage
            ? {
                meter: {
                  used: usage.daily_request_count,
                  limit: requests,
                  label: `${count(usage.daily_request_count)} of ${count(requests)} today`,
                },
              }
            : {}),
        }
      : { key: 'requests', name: 'Requests a day', sentence: 'No daily request limit.' }
  );
  if (!integration.ai_provider) return rows;

  const tokens = ai?.daily_token_limit ?? integration.ai_daily_token_limit;
  const day = ai?.daily_cost_limit_millicents ?? integration.ai_daily_cost_limit_millicents;
  const month = ai?.monthly_cost_limit_millicents ?? integration.ai_monthly_cost_limit_millicents;
  if (set(tokens))
    rows.push({
      key: 'tokens',
      name: 'AI tokens a day',
      sentence: `Calls stop once today’s tokens reach ${count(tokens)}.`,
      ...(ai
        ? {
            meter: {
              used: ai.daily_token_count,
              limit: tokens,
              label: `${count(ai.daily_token_count)} of ${count(tokens)} today`,
            },
          }
        : {}),
    });
  if (set(day))
    rows.push({
      key: 'cost-day',
      name: 'AI cost a day',
      sentence: `Calls stop at ${money(day)} of cost a day.`,
      ...(ai?.daily_cost_millicents != null
        ? {
            meter: {
              used: ai.daily_cost_millicents,
              limit: day,
              label: `${money(ai.daily_cost_millicents)} of ${money(day)} today`,
            },
          }
        : {}),
    });
  if (set(month))
    rows.push({
      key: 'cost-month',
      name: 'AI cost a month',
      sentence: `Calls stop at ${money(month)} of cost a month.`,
      ...(ai?.monthly_cost_millicents != null
        ? {
            meter: {
              used: ai.monthly_cost_millicents,
              limit: month,
              label: `${money(ai.monthly_cost_millicents)} of ${money(month)} this month`,
            },
          }
        : {}),
    });
  if (!set(tokens) && !set(day) && !set(month))
    rows.push({
      key: 'ai-none',
      name: 'AI limits',
      sentence: 'No AI limit: calls aren’t stopped for tokens or cost.',
    });
  return rows;
}

/** "3 integrations · 1 at its limit · 1 close", for the folded summary. */
export function integrationsSummary(rows: readonly (readonly IntegrationLimitRow[])[]): string {
  const meters = rows.flat().flatMap((row) => (row.meter ? [row.meter] : []));
  const at = meters.filter((m) => meterTone(m.used, m.limit) === 'critical').length;
  const close = meters.filter((m) => meterTone(m.used, m.limit) === 'warning').length;
  return [
    `${rows.length} integration${rows.length === 1 ? '' : 's'}`,
    at ? `${at} at its limit` : '',
    close ? `${close} close` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
