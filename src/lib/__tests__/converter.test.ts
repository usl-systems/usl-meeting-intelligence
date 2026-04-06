import { convertTranscript } from '../converter';

const SAMPLE_VTT = `WEBVTT

1
00:00:05.000 --> 00:00:10.000
<v Sarah Jones>Welcome everyone, um, let's get started with the update.</v>

2
00:00:10.500 --> 00:00:18.000
<v Sarah Jones>So, you know, the main thing we need to discuss today is the Q3 pipeline.</v>

3
00:00:18.500 --> 00:00:25.000
<v Mark Chen>Thanks Sarah. I've been looking at the numbers and uh we're tracking ahead.</v>

4
00:00:25.500 --> 00:00:32.000
<v Mark Chen>Revenue is up fifteen percent compared to last quarter.</v>

5
00:00:32.500 --> 00:00:40.000
<v Sarah Jones>That's great to hear. What about the enterprise segment specifically?</v>

6
00:00:40.500 --> 00:00:48.000
<v Mark Chen>Enterprise is actually our strongest area right now.</v>

7
00:00:48.500 --> 00:00:55.000
<v Lisa Park>I want to add that customer satisfaction scores are also trending up.</v>

8
00:00:55.500 --> 00:01:02.000
<v Lisa Park>We hit 4.6 out of 5 this month, which is a record.</v>

9
00:01:02.500 --> 00:01:10.000
<v Sarah Jones>Excellent. Let's make sure we document these wins for the board update.</v>

10
00:01:10.500 --> 00:01:18.000
<v Mark Chen>I'll prepare the slides by Friday. We should include the regional breakdown too.</v>`;

describe('convertTranscript', () => {
  it('converts VTT format to markdown with ## headings', () => {
    const result = convertTranscript(SAMPLE_VTT);

    // Should contain ## headings for each speaker block
    expect(result).toContain('## Sarah Jones');
    expect(result).toContain('## Mark Chen');
    expect(result).toContain('## Lisa Park');

    // Should have timestamps in headings
    expect(result).toMatch(/## .+ \[\d+:\d+\]/);

    // Should strip filler words
    expect(result).not.toMatch(/\bum\b/i);
    expect(result).not.toMatch(/\buh\b/i);

    // Should preserve meaningful content
    expect(result).toContain('Q3 pipeline');
    expect(result).toContain('fifteen percent');
    expect(result).toContain('4.6 out of 5');
  });

  it('converts speaker-labeled format to markdown', () => {
    const input = `SARAH JONES: Hello team, welcome to our weekly sync.
SARAH JONES: Let's start with updates from each department.
MARK CHEN: The backend migration is complete.
MARK CHEN: We finished testing yesterday.
LISA PARK: Frontend is on track for next week's release.`;

    const result = convertTranscript(input);

    expect(result).toContain('## Sarah Jones');
    expect(result).toContain('## Mark Chen');
    expect(result).toContain('## Lisa Park');
    expect(result).toContain('backend migration is complete');
  });

  it('handles raw paragraph format', () => {
    const input = `This meeting covered the quarterly review.

The team discussed revenue targets and customer feedback.

Next steps were assigned to department leads.`;

    const result = convertTranscript(input);

    expect(result).toContain('quarterly review');
    expect(result).toContain('revenue targets');
    expect(result).not.toContain('##');
  });

  it('strips filler words', () => {
    const input = `SARAH: Um, so like, the project is going well, you know.
MARK: I mean, the results are sort of what we expected, uh, mostly.`;

    const result = convertTranscript(input);

    expect(result).not.toMatch(/\bUm\b/);
    expect(result).not.toMatch(/\buh\b/);
    expect(result).toContain('project is going well');
  });

  it('returns empty string for empty input', () => {
    expect(convertTranscript('')).toBe('');
    expect(convertTranscript('   ')).toBe('');
  });
});
