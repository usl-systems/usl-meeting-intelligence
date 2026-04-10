import { runPreCheck } from '../qualityCheck';

const GOOD_SUMMARY = `## Executive Summary

- Revenue up 15% quarter over quarter
- Enterprise segment is strongest performer
- Customer satisfaction hit 4.6/5 record
- Q3 pipeline review completed successfully
- Board update slides due Friday

## Key Decisions

**Delay launch to Q2** — engineering needs 3 more weeks for auth flow (Decided by: Sarah Jones)
**Prioritize enterprise segment** — highest growth rate and margins (Decided by: Mark Chen)

## Customer Needs and Pain Points

Acme Corp needs faster onboarding — current 2-week timeline is blocking their Q3 rollout.
Beta users report confusion with the dashboard layout — 3 support tickets this week.

## Objections, Risks, and Open Questions

[Risk] Legal flagged data retention policy — may not meet new compliance requirements.
[Open Question] Do we need SOC2 certification before enterprise launch?

## Next Steps

| Owner | Action | Due Date |
|-------|--------|----------|
| Mark Chen | Send proposal to Acme Corp | 2025-04-11 |
| Sarah Jones | Prepare board update slides | 2025-04-11 |
| Lisa Park | Schedule compliance review | TBD |

## Key Quotes

> "Our onboarding takes two weeks and that's killing our Q3 plans" — **Acme Rep**
> "Enterprise is actually our strongest area right now" — **Mark Chen**
> "We hit 4.6 out of 5 this month, which is a record" — **Lisa Park**
> "Their legal team flagged our data retention policy" — **Mark Chen**

## Meeting Outcomes

- Agreed to delay launch to Q2 based on engineering timeline
- Enterprise segment confirmed as primary growth driver
- Compliance review escalated as a blocker

## Follow-Up Email Draft

Hi team, thanks for a productive Q3 review. Key outcomes: we're delaying launch to Q2 to complete auth, prioritizing enterprise, and escalating the compliance review. Mark will send the Acme proposal by Friday, and Sarah will prep board slides. Next check-in: Monday standup.
`;

describe('runPreCheck', () => {
  it('passes a well-structured summary with high score', () => {
    const result = runPreCheck(GOOD_SUMMARY);
    console.log('Score:', result.score, 'Issues:', result.issues);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.passed).toBe(true);
    expect(result.issues.filter(i => i.severity === 'high')).toHaveLength(0);
  });

  it('flags missing sections', () => {
    const partial = `## Executive Summary\n\n- Bullet one\n\n## Key Decisions\n\nDecision here.`;
    const result = runPreCheck(partial);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.description.includes('Next Steps'))).toBe(true);
  });

  it('flags short output', () => {
    const short = `## Executive Summary\n\nShort.`;
    const result = runPreCheck(short);
    expect(result.issues.some(i => i.type === 'short_output')).toBe(true);
  });
});
