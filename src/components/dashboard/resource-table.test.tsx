import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResourceTable, type Column } from './resource-table';

interface Row {
  id: string;
  name: string;
  calls: number;
}

const ROWS: Row[] = [
  { id: '1', name: 'checkout', calls: 30 },
  { id: '2', name: 'alpha-resize', calls: 100 },
  { id: '3', name: 'webhook', calls: 5 },
];

const COLUMNS: Column<Row>[] = [
  { key: 'name', label: 'Name' },
  { key: 'calls', label: 'Calls', numeric: true },
];

/** Body rows in render order, by their name cell. */
function names(): string[] {
  const [, ...bodyRows] = screen.getAllByRole('row'); // first row is the header
  return bodyRows.map((r) => within(r).getAllByRole('cell')[0].textContent ?? '');
}

const setup = (props: Partial<React.ComponentProps<typeof ResourceTable<Row>>> = {}) =>
  render(<ResourceTable rows={ROWS} columns={COLUMNS} {...props} />);

describe('rendering', () => {
  it('renders every row by default', () => {
    setup();
    expect(names()).toEqual(['checkout', 'alpha-resize', 'webhook']);
  });

  it('shows the empty state instead of a bare table when there is nothing', () => {
    render(<ResourceTable rows={[]} columns={COLUMNS} emptyMessage="No functions yet." />);
    expect(screen.getByText('No functions yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders an em dash for a missing value rather than "undefined"', () => {
    render(
      <ResourceTable
        rows={[{ id: '1', name: 'x' } as Row]}
        columns={[{ key: 'calls', label: 'Calls' }]}
      />
    );
    expect(screen.getByRole('cell')).toHaveTextContent('—');
  });
});

describe('sorting', () => {
  it('sorts text ascending on first click', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /name/i }));
    expect(names()).toEqual(['alpha-resize', 'checkout', 'webhook']);
  });

  it('sorts a numeric column descending first — the interesting end', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /calls/i }));
    expect(names()).toEqual(['alpha-resize', 'checkout', 'webhook']);
  });

  it('reverses direction on a second click', async () => {
    const user = userEvent.setup();
    setup();
    const header = screen.getByRole('button', { name: /name/i });
    await user.click(header);
    await user.click(header);
    expect(names()).toEqual(['webhook', 'checkout', 'alpha-resize']);
  });

  it('reports the sort state to assistive tech', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /name/i }));
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute(
      'aria-sort',
      'ascending'
    );
    expect(screen.getByRole('columnheader', { name: /calls/i })).toHaveAttribute(
      'aria-sort',
      'none'
    );
  });

  it('does not make a non-sortable column clickable', () => {
    render(
      <ResourceTable rows={ROWS} columns={[{ key: 'name', label: 'Name', sortable: false }]} />
    );
    expect(screen.queryByRole('button', { name: /name/i })).not.toBeInTheDocument();
  });
});

describe('filtering', () => {
  const filterable = { searchKeys: ['name'] as (keyof Row & string)[] };

  it('narrows to matching rows', async () => {
    const user = userEvent.setup();
    setup(filterable);
    await user.type(screen.getByRole('searchbox'), 'web');
    expect(names()).toEqual(['webhook']);
  });

  it('is case insensitive', async () => {
    const user = userEvent.setup();
    setup(filterable);
    await user.type(screen.getByRole('searchbox'), 'WEB');
    expect(names()).toEqual(['webhook']);
  });

  it('reports how many of the total are showing', async () => {
    const user = userEvent.setup();
    setup(filterable);
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'web');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('falls through to the empty state when nothing matches', async () => {
    const user = userEvent.setup();
    setup({ ...filterable, emptyMessage: 'Nothing matched.' });
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText('Nothing matched.')).toBeInTheDocument();
  });

  it('clears via the clear button', async () => {
    const user = userEvent.setup();
    setup(filterable);
    const input = screen.getByRole('searchbox');
    await user.type(input, 'web');
    await user.click(screen.getByRole('button', { name: /clear filter/i }));
    expect(input).toHaveValue('');
    expect(names()).toHaveLength(3);
  });

  it('clears on Escape without giving up focus', async () => {
    const user = userEvent.setup();
    setup(filterable);
    const input = screen.getByRole('searchbox');
    await user.type(input, 'web');
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('offers no clear button until there is something to clear', () => {
    setup(filterable);
    expect(screen.queryByRole('button', { name: /clear filter/i })).not.toBeInTheDocument();
  });

  it('hides the filter entirely when no search keys are given', () => {
    setup();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});

describe('row actions', () => {
  it('renders actions in their own shielded cell — pressing one never fires the row', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const onAction = vi.fn();
    setup({
      onRowClick,
      rowActions: (row) => (
        <button type="button" onClick={() => onAction(row.id)}>
          Delete {row.name}
        </button>
      ),
    });
    await user.click(screen.getByRole('button', { name: 'Delete checkout' }));
    expect(onAction).toHaveBeenCalledWith('1');
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('bounded rendering', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({
    id: String(i),
    name: `fn-${String(i).padStart(3, '0')}`,
    calls: i,
  }));

  it('renders the first page and says how much is not shown', () => {
    render(<ResourceTable rows={many} columns={COLUMNS} />);
    expect(names()).toHaveLength(51); // 50 data rows + the show-more row
    expect(screen.getByRole('button', { name: /70 not shown/i })).toBeInTheDocument();
  });

  it('reveals another page on demand', async () => {
    const user = userEvent.setup();
    render(<ResourceTable rows={many} columns={COLUMNS} />);
    await user.click(screen.getByRole('button', { name: /not shown/i }));
    expect(screen.getByRole('button', { name: /20 not shown/i })).toBeInTheDocument();
  });

  it('never truncates a table that fits', () => {
    setup();
    expect(screen.queryByRole('button', { name: /not shown/i })).not.toBeInTheDocument();
  });
});

describe('controlled query', () => {
  it('reads and reports the filter through the controlled pair', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    setup({ searchKeys: ['name'], query: 'web', onQueryChange });
    // The controlled value filters the rows…
    expect(names()).toEqual(['webhook']);
    // …and typing reports upward instead of mutating internal state.
    await user.type(screen.getByRole('searchbox'), 'x');
    expect(onQueryChange).toHaveBeenCalledWith('webx');
  });
});

describe('row activation', () => {
  it('calls back on click', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    setup({ onRowClick });
    await user.click(screen.getAllByRole('button', { name: /checkout/i })[0]);
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'checkout' }));
  });

  it('activates from the keyboard, so rows are not mouse-only', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    setup({ onRowClick });
    screen.getAllByRole('button', { name: /checkout/i })[0].focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('leaves rows inert when no handler is given', () => {
    setup();
    // Sortable column headers are buttons, so this has to look at the rows
    // themselves: without a handler they are neither focusable nor clickable.
    const [, ...bodyRows] = screen.getAllByRole('row');
    for (const row of bodyRows) {
      expect(row).not.toHaveAttribute('role', 'button');
      expect(row).not.toHaveAttribute('tabindex');
    }
  });
});
