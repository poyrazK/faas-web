import { Profiler } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FieldFigure } from './field-figure';
import {
  COMPUTE,
  DEPLOYS,
  DOMAINS,
  PREVIEWS,
  SECRETS,
  STORAGE,
  TRACES,
  type Field,
} from './geometry';

const FIELDS: [string, Field][] = [
  DEPLOYS,
  COMPUTE,
  DOMAINS,
  TRACES,
  SECRETS,
  PREVIEWS,
  STORAGE,
].map((field) => [field.name, field]);

function frameOf(container: HTMLElement, field: Field) {
  return container.querySelector<HTMLElement>(`[data-figure="${field.name}"]`)!;
}

function rowsOf(container: HTMLElement, field: Field) {
  return [...frameOf(container, field).querySelectorAll('svg > g')].map((g) =>
    [...g.querySelectorAll('path')].map((path) => path.getAttribute('d'))
  );
}

function restingRows(field: Field) {
  return Array.from({ length: field.rows }, (_, r) => {
    const row = field.row(r, 0, 0, 0);
    return field.layers.map((layer) => row[layer.key]);
  });
}

describe('Hosting figures', () => {
  it.each(FIELDS)('%s is a wordless, decorative texture within budget', (_, field) => {
    const { container } = render(<FieldFigure field={field} />);
    const svg = frameOf(container, field).querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelectorAll('text')).toHaveLength(0);
    const paths = svg.querySelectorAll('path').length;
    expect(paths).toBe(field.rows * field.layers.length);
    expect(paths).toBeLessThanOrEqual(60);
  });

  it.each(FIELDS)('%s draws its resting frame, layer by layer, row by row', (_, field) => {
    const { container } = render(<FieldFigure field={field} />);
    expect(rowsOf(container, field)).toEqual(restingRows(field));
  });

  it.each(FIELDS)('%s inks only with theme tokens', (_, field) => {
    const { container } = render(<FieldFigure field={field} />);
    for (const path of frameOf(container, field).querySelectorAll('path')) {
      expect(path.getAttribute('fill')).toMatch(/^(none|var\(--(brand|background)\))$/);
      expect(path.getAttribute('stroke')).toMatch(/^(none|var\(--(brand|background)\))$/);
    }
  });

  it.each(FIELDS)('%s moves under the pointer without a React commit', async (_, field) => {
    let commits = 0;
    const { container } = render(
      <Profiler id={field.name} onRender={() => (commits += 1)}>
        <FieldFigure field={field} />
      </Profiler>
    );
    const frame = frameOf(container, field);
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 420,
      height: 200,
      right: 420,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    await act(async () => {});
    const before = commits;
    fireEvent.pointerEnter(frame, { clientX: 60, clientY: 60 });
    for (let i = 0; i < 50; i++)
      fireEvent.pointerMove(frame, { clientX: 60 + 6 * i, clientY: 60 + i });
    await waitFor(() => expect(rowsOf(container, field)).not.toEqual(restingRows(field)));
    expect(commits).toBe(before);
  });

  it.each(FIELDS)('%s wakes visibly on keyboard focus of its panel', async (_, field) => {
    const { container, getByTestId } = render(
      <div tabIndex={0} data-testid="panel">
        <FieldFigure field={field} />
      </div>
    );
    fireEvent.focusIn(getByTestId('panel'));
    await waitFor(() => expect(rowsOf(container, field)).not.toEqual(restingRows(field)));
  });
});
