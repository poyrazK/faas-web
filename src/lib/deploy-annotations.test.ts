import { describe, expect, it } from 'vitest';
import { annotationsBody, DEPLOY_TAGS, EMPTY_ANNOTATIONS } from './deploy-annotations';

/**
 * The wire body carries only what the person filled in: blanks are omitted
 * (not sent as ""), the PR number is a number, and a reason longer than the
 * API's 280 characters is cut rather than rejected server-side after the
 * build has been queued.
 */
describe('annotationsBody', () => {
  it('omits blank fields entirely', () => {
    expect(annotationsBody(EMPTY_ANNOTATIONS)).toEqual({});
  });

  it('sends the filled fields with pr_number as an integer', () => {
    expect(
      annotationsBody({
        reason: ' hotfix for #12 ',
        tag: 'hotfix',
        deployed_by: 'ada',
        pr_number: '12',
      })
    ).toEqual({ reason: 'hotfix for #12', tag: 'hotfix', deployed_by: 'ada', pr_number: 12 });
  });

  it('drops a non-numeric pr_number and truncates reason to 280 chars', () => {
    const body = annotationsBody({
      reason: 'x'.repeat(300),
      tag: '',
      deployed_by: '',
      pr_number: 'abc',
    });
    expect(body.pr_number).toBeUndefined();
    expect(body.reason).toHaveLength(280);
  });

  it('exposes the five closed-set tags in the spec order', () => {
    expect(DEPLOY_TAGS.map((t) => t.value)).toEqual([
      'incident_recovery',
      'hotfix',
      'scheduled_maintenance',
      'compliance_hold',
      'partner_request',
    ]);
  });
});
