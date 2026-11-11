import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResourceTable, type Column } from './resource-table';

type Row = { id: string; name: string; size: number };
const rows: Row[] = [
  { id: 'a', name: 'alpha', size: 3 },
  { id: 'b', name: 'bravo', size: 1 },
  { id: 'c', name: 'charlie', size: 2 },
];
const columns: Column<Row>[] = [
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size', numeric: true },
];

describe('ResourceTable keyboard and sort', () => {
  it('walks clickable rows with j/k and the arrows, and opens with Enter', async () => {
    const open = vi.fn();
    render(<ResourceTable rows={rows} columns={columns} onRowClick={open} />);
    const [alpha, bravo, charlie] = screen.getAllByRole('button', { name: /alpha|bravo|charlie/ });
    alpha.focus();
    await userEvent.keyboard('j');
    expect(bravo).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(charlie).toHaveFocus();
    await userEvent.keyboard('j');
    expect(charlie).toHaveFocus();
    await userEvent.keyboard('k');
    expect(bravo).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(open).toHaveBeenCalledWith(rows[1]);
  });

  it('shows one arrow whose direction follows the sort', async () => {
    render(<ResourceTable rows={rows} columns={columns} />);
    const header = screen.getByRole('columnheader', { name: /Size/ });
    await userEvent.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(header.querySelector('.rt-sort-arrow')).toHaveAttribute('data-dir', 'desc');
    await userEvent.click(within(header).getByRole('button'));
    expect(header.querySelector('.rt-sort-arrow')).toHaveAttribute('data-dir', 'asc');
  });
});
