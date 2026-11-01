import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { PracticalQuestions } from './practical-questions';

describe('practical questions', () => {
  // jsdom has no layout, so this pins the rule that keeps the row still; that
  // the longest card fits was measured in a browser at every desktop width.
  it('keeps every card at one fixed height, open or closed', async () => {
    render(withRouter(<PracticalQuestions />));
    const cards = await screen.findAllByRole('button');
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card).toHaveClass('lg:h-[26rem]');
      expect(card).not.toHaveClass('lg:min-h-[26rem]');
    }
  });
});
