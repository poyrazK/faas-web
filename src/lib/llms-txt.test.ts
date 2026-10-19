import { describe, expect, it } from 'vitest';
import { DOC_ENTRIES, DOC_SECTIONS } from './docs-manifest';
import { renderLlmsTxt } from './llms-txt';
import { INSTALL_COMMAND, RESTORE_CONTEXT, RESTORE_TARGET } from './platform-claims';

/**
 * `/llms.txt` is what an assistant reads when someone asks it what Gregale
 * is, so it is held to the same claims as the landing page — and derived from
 * the same sources, so a docs page or a reworded claim cannot leave it stale.
 */

const SITE = 'https://gregale.dev';
const text = renderLlmsTxt(SITE);

describe('renderLlmsTxt', () => {
  it('opens with the site name as an H1', () => {
    expect(text.startsWith('# Gregale\n')).toBe(true);
  });

  it('states the wake figure only as the sanctioned claim, with its context', () => {
    expect(text).toContain(RESTORE_TARGET);
    expect(text).toContain(RESTORE_CONTEXT);
    // The docs summary for scale-to-zero carries the same claim, so it can
    // appear more than once — but never in any other wording.
    expect(text.replaceAll(RESTORE_TARGET, '')).not.toMatch(/350\s*ms/);
  });

  it('gives the install command the site advertises', () => {
    expect(text).toContain(INSTALL_COMMAND);
  });

  it('lists every published docs page under its section, with its summary', () => {
    for (const section of DOC_SECTIONS) {
      expect(text).toContain(`## ${section.title}`);
    }
    for (const entry of DOC_ENTRIES) {
      expect(text).toContain(`[${entry.title}](${SITE}/docs/${entry.slug})`);
      expect(text).toContain(entry.summary);
    }
  });

  it('names no hosting provider or datacentre', () => {
    // Providers are the sub-processor list's to name; a hard-coded one here
    // was stale within weeks last time.
    expect(text).not.toMatch(/hetzner|frankfurt|google cloud|gcp|bare[\s-]?metal/i);
  });

  it('does not describe a proprietary product as open source', () => {
    expect(text).not.toMatch(/open[\s-]?source/i);
  });

  it('describes the beta honestly', () => {
    expect(text).toMatch(/public beta/i);
    expect(text).toMatch(/billing.*disabled|disabled.*billing/i);
  });

  it('ends with a trailing newline', () => {
    expect(text.endsWith('\n')).toBe(true);
  });
});
