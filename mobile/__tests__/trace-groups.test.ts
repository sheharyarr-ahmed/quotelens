// groupTraces attempt splitting (SPEC.md - Mobile UI/UX - Trace viewer):
// retry runs render as a second attempt group behind a divider.

import { groupTraces } from '../src/lib/traceGroups';

const PIPELINE = [
  'transcribe',
  'analyze_photos',
  'parse_walkthrough',
  'match_pricebook',
  'draft_line_items',
  'validate',
  'compile_quote',
];

const t = (node: string) => ({ node });

describe('groupTraces', () => {
  test('clean 7-node run is a single group', () => {
    const groups = groupTraces(PIPELINE.map(t));

    expect(groups).toHaveLength(1);
    expect(groups[0].map((trace) => trace.node)).toEqual(PIPELINE);
  });

  test('validate retry splits at the second draft_line_items', () => {
    // validate fails once, so draft_line_items + validate run twice before
    // compile_quote.
    const run = [
      'transcribe',
      'analyze_photos',
      'parse_walkthrough',
      'match_pricebook',
      'draft_line_items',
      'validate',
      'draft_line_items',
      'validate',
      'compile_quote',
    ].map(t);

    const groups = groupTraces(run);

    expect(groups).toHaveLength(2);
    expect(groups[0].map((trace) => trace.node)).toEqual([
      'transcribe',
      'analyze_photos',
      'parse_walkthrough',
      'match_pricebook',
      'draft_line_items',
      'validate',
    ]);
    expect(groups[1].map((trace) => trace.node)).toEqual([
      'draft_line_items',
      'validate',
      'compile_quote',
    ]);
  });

  test('regenerate-style full rerun starts a new group', () => {
    const groups = groupTraces([...PIPELINE, ...PIPELINE].map(t));

    expect(groups).toHaveLength(2);
    expect(groups[0].map((trace) => trace.node)).toEqual(PIPELINE);
    expect(groups[1].map((trace) => trace.node)).toEqual(PIPELINE);
  });

  test('empty list produces no groups', () => {
    expect(groupTraces([])).toEqual([]);
  });
});
