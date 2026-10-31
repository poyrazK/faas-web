# Sidebar by Resource Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regroup the console's account-wide sidebar from Build / Operate / Account into Compute, Storage, Networking, Messaging, Monetize, Observe and Account.

**Architecture:** The rail, breadcrumb, page titles and ⌘K palette are all derived from `src/components/dashboard/nav-config.ts`, so the regroup is a config change plus the tests that pin the rail's shape. `shell.tsx` renders whatever `NAV_GROUPS` says and does not change. Two small code changes ride along: a guard in `secondary-navigation.tsx` that would otherwise hide the "App sections" strip, and an unrendered `keywords` field on palette commands so category words still find their pages.

**Tech Stack:** React 19, TanStack Router, Vite, Vitest + React Testing Library, Tailwind, Iconoir icons.

**Spec:** `docs/superpowers/specs/2026-10-20-sidebar-categories-design.md`. Read it before starting. Its "Revisions" section lists three corrections found while writing this plan; this plan already includes them.

## Global Constraints

- Work in the worktree `/home/bahadir/GREGALE/.worktrees/faas-web-sidebar-categories`, branch `feat/console-sidebar-categories`. Never `cd` to `/home/bahadir/GREGALE/faas-web`: that checkout is parked on an unrelated branch.
- Read `CLAUDE.md` and `README.md` in the worktree first.
- Account-wide pages only in the rail. Per-app resources stay app tabs (`APP_TABS`).
- Do not rename anything the naming proposal owns: Releases, Jobs, Cron Jobs, Customers, Deployments and the rest keep their labels.
- No change to `src/components/dashboard/shell.tsx`.
- No new colour tokens. Reuse `text-cat-compute/80`, `text-cat-storage/80`, `text-cat-network/80`, `text-cat-security/80`, `text-brand/80`.
- All 18 redirect routes keep resolving. Do not touch any `src/routes/dashboard.*.tsx` file except `dashboard.storage.tsx`.
- No literal hex colours and no `dark:` variants in components (`src/lib/conventions.test.ts` enforces this).
- Never hand-edit `src/routeTree.gen.ts` or `src/lib/api/schema.d.ts`.
- Do not reformat files you did not otherwise change. Run Prettier only on files you touched.
- Tests: Vitest + React Testing Library, beside the code. Run with `npx vitest run --maxWorkers=8`; default workers time out on this machine. A run passes only when the exit code is 0 **and** the summary has no "Errors" line.
- `npm run lint` must report 0 errors and no more than the existing 4 warnings.
- Commits: conventional (`feat(console): …`, `test(console): …`, `docs(console): …`), each with a body that says why. Use the repo's configured git identity. **Do not push.**

## Review Focus

These are the inputs most likely to bite a real person that the spec does not spell out. Each one has a test in the task named.

1. **A saved closed-group set from the old rail.** Someone who shut Data, Observe or Projects has `["/dashboard/storage","/dashboard/debug","/dashboard/projects"]` in `gregale.sidebar.closedGroups`. Every row must still show, and Billing must still be open. Test in Task 1.
2. **Standalone per-app pages.** `/dashboard/logs` and the other per-app pages without a rail row must keep their "App sections" strip and light Projects as the one current row. Debugger and Edge rules, now rail rows, drop the strip. Test and fix in Task 1.
3. **The collapsed rail.** With the rail collapsed, every top-level row keeps an accessible name, Billing's three rows are hidden behind its button, and nothing else disappears. Test in Task 1.
4. **Saved ⌘K recents.** Recents saved as the removed hub aliases (`hub-/dashboard/storage` was "Data", `hub-/dashboard/debug` was "Observe") must drop out quietly. Recents for pages that still exist, including palette-only Templates, must still show. Test in Task 1.
5. **Typing a category word into ⌘K.** "Observe", "Storage" and "Networking" used to be, or now look like, destinations. Typing one must list the pages filed under that heading. Test in Task 2. The old hub name "Data" is deliberately not aliased; after the change it matches only "Data and privacy".

## File Structure

| File                                                | Change                                                                 | Task |
| --------------------------------------------------- | ---------------------------------------------------------------------- | ---- |
| `src/components/dashboard/nav-config.ts`            | New hubs, new groups, `PALETTE_ONLY`, comments; later `railGroupFor()` | 1, 2 |
| `src/components/dashboard/secondary-navigation.tsx` | Guard no longer needs hub sections; app strip hidden on rail rows      | 1    |
| `src/routes/dashboard.storage.tsx`                  | `PageHeader` title "Object storage"                                    | 1    |
| `src/components/dashboard/navigation.test.tsx`      | Rail fixtures and tests for the new shape                              | 1, 2 |
| `src/routes/-dashboard.projects.test.tsx`           | Rail link "All projects" becomes "Projects"                            | 1    |
| `src/lib/seo.test.ts`                               | Titles for storage, edge-rules, templates                              | 1    |
| `README.md`                                         | One bullet about how the rail is grouped                               | 1    |
| `src/components/dashboard/command-palette.tsx`      | `keywords` field on commands, matched but not rendered                 | 2    |
| `src/components/dashboard/nav-config.test.ts`       | New: `railGroupFor()` unit tests                                       | 2    |

---

### Task 1: Regroup the rail by resource category

**Files:**

- Modify: `src/components/dashboard/nav-config.ts` (imports, `NAV_HUBS`, `SIDEBAR_GROUPS` and its comment, `NAV_ITEMS`, the comment in `findNavHub`)
- Modify: `src/components/dashboard/secondary-navigation.tsx` (`DashboardSecondaryNavigation`)
- Modify: `src/routes/dashboard.storage.tsx` (`StoragePage`)
- Modify: `README.md` (the "Adding a console page" bullet)
- Test: `src/components/dashboard/navigation.test.tsx`, `src/routes/-dashboard.projects.test.tsx`, `src/lib/seo.test.ts`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces for Task 2: `NAV_GROUPS: NavGroup[]` in rail order, with titles exactly `Compute`, `Storage`, `Networking`, `Messaging`, `Monetize`, `Observe`, `Account` after the untitled Overview group. Hub labels exactly as in `RAIL` below. `NavItem`, `NavHub` and `NavGroup` types are unchanged.

- [ ] **Step 1: Replace the rail fixtures in `navigation.test.tsx`**

Replace the block from `const RAIL = [` down to the closing `];` of `const GROUPS = [` (currently lines 253–350) with:

```tsx
const RAIL = [
  'Overview',
  'Projects',
  'Releases',
  'Jobs',
  'Instances',
  'Object storage',
  'Postgres',
  'Domains',
  'Edge rules',
  'Events',
  'Integrations',
  'Customers',
  'Analytics',
  'Debugger',
  'Invocations',
  'Audit Log',
  'Usage',
  'Invoices',
  'Plans',
  'Settings',
];

/**
 * Hubs that disclose a group rather than link to one.
 *
 * Their landing page rides along as the group's first child, which is what lets
 * the parent be a button: the router marks every active link
 * `aria-current="page"` last and unconditionally, so a second link to the same
 * URL would be a second current page that no prop can suppress.
 */
const RAIL_PARENTS = ['Billing'];

/** The rail's headings and the links filed under each, in order. */
const RAIL_GROUP_ROWS: Record<string, string[]> = {
  Compute: ['Projects', 'Releases', 'Jobs', 'Instances'],
  Storage: ['Object storage', 'Postgres'],
  Networking: ['Domains', 'Edge rules'],
  Messaging: ['Events', 'Integrations'],
  Monetize: ['Customers'],
  Observe: ['Analytics', 'Debugger', 'Invocations', 'Audit Log'],
  Account: ['Usage', 'Invoices', 'Plans', 'Settings'],
};

/** The rows under one rail heading: the wrapper that holds the heading and its list. */
function railGroup(main: HTMLElement, title: string) {
  const heading = within(main).getByText(title, { selector: 'p' });
  return within(heading.parentElement!.parentElement!);
}

/**
 * Where a hub's sections live. They are rail rows for every hub but Settings,
 * whose eight `?section=` panels stay the page's own tabs.
 */
function sectionsNav(hub: string) {
  return screen.getByRole('navigation', {
    name: hub === 'Settings' ? 'Settings sections' : 'Main',
  });
}
const GROUPS = [
  {
    hub: 'Billing',
    anchor: '/dashboard/usage',
    links: [
      ['Usage', '/dashboard/usage'],
      ['Invoices', '/dashboard/invoices'],
      ['Plans', '/dashboard/plans'],
    ],
  },
  {
    hub: 'Settings',
    anchor: '/dashboard/settings',
    links: [
      ['General', '/dashboard/settings?section=general'],
      ['Organization', '/dashboard/settings?section=organization'],
      ['Members', '/dashboard/settings?section=members'],
      ['API keys', '/dashboard/settings?section=api-keys'],
      ['Security', '/dashboard/settings?section=security'],
      ['Integrations', '/dashboard/settings?section=integrations'],
      ['Platform limits', '/dashboard/settings?section=platform-limits'],
      ['Data and privacy', '/dashboard/settings?section=data-and-privacy'],
    ],
  },
];
```

- [ ] **Step 2: Update the first rail test to check each heading's rows**

In `it('keeps every hub and section visible in desktop and mobile navigation', …)`, replace:

```tsx
for (const title of [...RAIL_GROUPS, ...RAIL_PARENTS])
  expect(within(main).getByText(title)).toBeInTheDocument();
```

with:

```tsx
for (const [title, rows] of Object.entries(RAIL_GROUP_ROWS))
  expect(
    railGroup(main, title)
      .getAllByRole('link')
      .map((link) => link.textContent)
  ).toEqual(rows);
```

Leave the rest of that test as it is. Its `RAIL_PARENTS` loop now checks only Billing.

- [ ] **Step 3: Retarget the disclosure test at Billing and add the stale-entries and collapsed-rail tests**

Replace the whole `it('shuts a disclosure, remembers it, and leaves the others open', …)` test with these three tests:

```tsx
it('shuts a disclosure, remembers it, and leaves the rest of the rail open', async () => {
  await renderShell();
  const main = screen.getByRole('navigation', { name: 'Main' });
  const billing = within(main).getByRole('button', { name: 'Billing' });

  expect(within(main).getByRole('link', { name: 'Invoices' })).toBeInTheDocument();
  await userEvent.click(billing);
  expect(billing).toHaveAttribute('aria-expanded', 'false');
  // The panel collapses on an exit animation, so the rows leave the document
  // when it finishes rather than on the click. aria-expanded flips at once,
  // which is what assistive tech reads.
  await waitFor(() => expect(within(main).queryByRole('link', { name: 'Invoices' })).toBeNull());
  // Shutting Billing must not touch the rows around it.
  expect(within(main).getByRole('link', { name: 'Settings' })).toBeInTheDocument();

  // Stored as the closed set, so a hub nobody has shut stays open — including
  // one that does not exist yet.
  expect(JSON.parse(window.localStorage.getItem('gregale.sidebar.closedGroups') ?? '[]')).toEqual([
    '/dashboard/usage',
  ]);

  await userEvent.click(billing);
  expect(billing).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() =>
    expect(within(main).getByRole('link', { name: 'Invoices' })).toBeInTheDocument()
  );
  expect(JSON.parse(window.localStorage.getItem('gregale.sidebar.closedGroups') ?? '[]')).toEqual(
    []
  );
});

it('ignores closed-group entries saved by the previous rail', async () => {
  // Data, Observe and Projects were disclosures before the regroup. A reader
  // who shut one must not lose rows that are plain links now.
  window.localStorage.setItem(
    'gregale.sidebar.closedGroups',
    JSON.stringify(['/dashboard/storage', '/dashboard/debug', '/dashboard/projects'])
  );
  await renderShell();
  const main = screen.getByRole('navigation', { name: 'Main' });
  expect(
    within(main)
      .getAllByRole('link')
      .map((link) => link.textContent)
  ).toEqual(RAIL);
  expect(within(main).getByRole('button', { name: 'Billing' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
});

it('keeps every top-level row reachable by name in the collapsed rail', async () => {
  window.localStorage.setItem('gregale.sidebar.collapsed', '1');
  await renderShell();
  const main = screen.getByRole('navigation', { name: 'Main' });
  expect(main.closest('aside')).toHaveClass('w-16');
  // Collapsed, labels move to aria-label and the second level folds away.
  expect(
    within(main)
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label'))
  ).toEqual(RAIL.filter((label) => !['Usage', 'Invoices', 'Plans'].includes(label)));
  expect(within(main).getByRole('button', { name: 'Billing' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
});
```

- [ ] **Step 4: Rewrite the app-sections test and add the own-row test**

Replace the whole `it('keeps standalone app sections, including Edge rules, accessible from app pages', …)` test with:

```tsx
it('keeps the app sections strip on per-app pages and lights Projects there', async () => {
  await renderShell('/dashboard/logs');
  const sections = screen.getByRole('navigation', { name: 'App sections' });
  for (const [label, path] of [
    ['Logs', 'logs'],
    ['Routes', 'routes'],
    ['Upstreams', 'upstreams'],
    ['Edge rules', 'edge-rules'],
    ['OpenAPI', 'openapi'],
  ]) {
    expect(within(sections).getByRole('link', { name: label })).toHaveAttribute(
      'href',
      `/dashboard/${path}`
    );
  }
  const main = screen.getByRole('navigation', { name: 'Main' });
  // Logs has no rail row: the rail shows its branch, and says so only once.
  expect(within(main).getByRole('link', { name: 'Projects' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  expect(main.querySelectorAll('[aria-current="page"]')).toHaveLength(1);

  await userEvent.click(within(sections).getByRole('link', { name: 'Edge rules' }));
  await waitFor(() =>
    expect(screen.getByTestId('page')).toHaveTextContent('/dashboard/edge-rules')
  );
  // Edge rules is a rail row now. Its page is the account view, so the
  // per-app strip goes; the app page's Connect tab is the per-app way in.
  expect(within(main).getByRole('link', { name: 'Edge rules' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  expect(screen.queryByRole('navigation', { name: 'App sections' })).not.toBeInTheDocument();
});

it.each([
  ['/dashboard/instances', 'Instances'],
  ['/dashboard/postgres', 'Postgres'],
  ['/dashboard/edge-rules', 'Edge rules'],
  ['/dashboard/debug', 'Debugger'],
])('lights %s as its own rail row', async (path, label) => {
  await renderShell(path);
  const main = screen.getByRole('navigation', { name: 'Main' });
  expect(within(main).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  expect(main.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(screen.queryByRole('navigation', { name: 'App sections' })).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Rename Storage and Data in the keyboard and focus tests**

In `it('uses link keyboard navigation and restores hub selection with browser Back', …)`, change the three `{ name: 'Storage' }` lookups to `{ name: 'Object storage' }`. Keep the rest: Object storage and Postgres are still adjacent rows, so Tab still moves between them.

Replace the body of `it('honors keyboard collapse while focus is inside the rail', …)` with:

```tsx
await renderShell();
const main = screen.getByRole('navigation', { name: 'Main' });
await act(async () => within(main).getByRole('link', { name: 'Invoices' }).focus());
await userEvent.keyboard('{Control>}b{/Control}');
expect(main.closest('aside')).toHaveClass('w-16');
expect(within(main).getByRole('button', { name: 'Billing' })).toHaveFocus();
expect(within(main).queryByRole('link', { name: 'Invoices' })).not.toBeInTheDocument();
```

Replace the body of `it('keeps disclosure triggers mounted and focused while the compact rail expands', …)` with:

```tsx
window.localStorage.setItem('gregale.sidebar.collapsed', '1');
await renderShell();
const main = screen.getByRole('navigation', { name: 'Main' });
const billing = within(main).getByRole('button', { name: 'Billing' });
await act(async () => billing.focus());
expect(billing).toHaveFocus();
expect(billing).toBe(within(main).getByRole('button', { name: 'Billing' }));
expect(main.closest('aside')).toHaveClass('w-60');
expect(window.localStorage.getItem('gregale.sidebar.collapsed')).toBe('1');
```

In `it('preserves search and hash state when the current section is reselected', …)`, change `name: 'Storage'` to `name: 'Object storage'`.

- [ ] **Step 6: Update the breadcrumb, Projects and Apps tests**

Replace the whole `it('identifies only the current page in a hub anchor breadcrumb', …)` test with:

```tsx
it('names a rail row once in its breadcrumb', async () => {
  await renderShell('/dashboard/debug');
  const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
  // Observe is a heading now, not a hub, so it is not a crumb.
  expect(within(breadcrumb).queryByText('Observe')).not.toBeInTheDocument();
  expect(within(breadcrumb).getByText('Debugger')).toHaveAttribute('aria-current', 'page');
  expect(breadcrumb.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});
```

In `it('preserves a Projects bookmark when its primary destination is reselected', …)`, change `name: 'All projects'` to `name: 'Projects'`.

Replace the body of `it('files apps under Projects: no Apps row, and app pages light Projects', …)` with:

```tsx
await renderShell('/dashboard/apps/api');
const main = screen.getByRole('navigation', { name: 'Main' });
expect(within(main).queryByRole('link', { name: 'All apps' })).toBeNull();
expect(within(main).queryByRole('link', { name: 'Apps' })).toBeNull();
expect(within(main).getByRole('link', { name: 'Projects' })).toHaveAttribute(
  'aria-current',
  'page'
);
expect(main.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
```

- [ ] **Step 7: Add the stale-recents test and update the search tests**

Directly after `it('keeps saved legacy page commands available as recent commands', …)`, add:

```tsx
it('drops saved commands for removed hub aliases and keeps the rest', async () => {
  // "Data" and "Observe" were hub aliases with their own ids. Their pages are
  // still listed, under their own names.
  window.localStorage.setItem(
    'gregale.palette.recent',
    JSON.stringify([
      'hub-/dashboard/storage',
      'hub-/dashboard/debug',
      'nav-/dashboard/storage',
      'nav-/dashboard/templates',
    ])
  );
  await renderShell();
  await userEvent.keyboard('{Control>}k{/Control}');
  await screen.findByRole('combobox', { name: 'Search commands' });
  const options = screen.getAllByRole('option').map((option) => option.textContent);
  expect(options.slice(0, 2)).toEqual(['Object storage', 'Templates']);
  expect(options).not.toContain('Data');
  expect(options).not.toContain('Observe');
});
```

In `it('keeps overview search results unique while changing between hub and page searches', …)`, replace everything from `await user.type(input, 'Data');` to the end of the test body with:

```tsx
await user.type(input, 'Data');
expect(
  screen
    .getAllByRole('option')
    .map((option) => option.textContent)
    .filter((text) => text?.endsWith('Page'))
).toEqual(['Data and privacyPage']);
await user.clear(input);
await user.type(input, 'Storage');
expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
  'Object storagePage',
]);
await user.clear(input);
// Debugger is both a rail row and an app section: one result, not two.
await user.type(input, 'Debugger');
expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['DebuggerPage']);
```

In the final `it.each([...])('opens %s from the command palette without duplicate results', …)`, replace the table with:

```tsx
  it.each([
    ['Releases', '/dashboard/releases'],
    ['Analytics', '/dashboard/analytics'],
    ['Builds', '/dashboard/builds'],
    ['Object storage', '/dashboard/storage'],
    ['Debugger', '/dashboard/debug'],
    ['Edge rules', '/dashboard/edge-rules'],
    ['Instances', '/dashboard/instances'],
    ['Templates', '/dashboard/templates'],
    ['Import', '/dashboard/import'],
    ['Billing', '/dashboard/usage'],
  ])('opens %s from the command palette without duplicate results', async (label, path) => {
```

Leave the test body unchanged.

- [ ] **Step 8: Update the projects test and add the title test**

In `src/routes/-dashboard.projects.test.tsx`, in the assertion that reads the rail inside `navigation` named `Main` (around line 148), change `name: 'All projects'` to `name: 'Projects'`. Leave the later lookup that filters out `nav[aria-label="Main"]` unchanged; it targets the page's own back link.

In `src/lib/seo.test.ts`, inside `describe('consoleHead', …)`, add after the first `it`:

```ts
it('titles the regrouped rail rows by their rail labels', () => {
  expect(titleOf(consoleHead('storage'))).toBe('Object storage · Gregale');
  expect(titleOf(consoleHead('edge-rules'))).toBe('Edge rules · Gregale');
  expect(titleOf(consoleHead('templates'))).toBe('Templates · Gregale');
});
```

- [ ] **Step 9: Run the tests and confirm they fail for the right reason**

Run:

```bash
npx vitest run --maxWorkers=8 src/components/dashboard/navigation.test.tsx src/routes/-dashboard.projects.test.tsx src/lib/seo.test.ts
```

Expected: FAIL. The rail list still reads `All projects, Templates, Import, …`; there is no `Compute` heading; `Billing` is not the only disclosure; `consoleHead('storage')` is `Storage · Gregale`. Record the command and the key failing lines for the report. If a test fails for another reason, such as a syntax error or a missing helper, fix the test first.

- [ ] **Step 10: Add `FilterList` to the nav-config imports**

In `src/components/dashboard/nav-config.ts`, add `FilterList,` to the `iconoir-react` import list, directly after `Database,`. Keep every other import: `Cube` and `Upload` are still used by `PALETTE_ONLY` below, and `Server`, `Activity`, `Journal` and `Search` move from the old Observe sections to the new hubs.

- [ ] **Step 11: Replace `NAV_HUBS`**

Replace the whole `export const NAV_HUBS: NavHub[] = [ … ];` array with:

```ts
/** Existing pages anchor each hub until its feature composition is ready. */
export const NAV_HUBS: NavHub[] = [
  {
    to: '/dashboard',
    label: 'Overview',
    icon: ViewGrid,
    exact: true,
    sidebarIconClassName: 'text-brand/80',
  },
  {
    // Projects are the way in: apps live inside them (standalone apps are a
    // group on the Projects page), so there is no separate Apps row. The app
    // list, app pages and standalone per-app pages light this row. Templates
    // and Import used to nest here; both redirect into the New app wizard, so
    // they live in PALETTE_ONLY rather than as rows that are never current.
    to: '/dashboard/projects',
    label: 'Projects',
    icon: Folder,
    sidebarIconClassName: 'text-cat-compute/80',
  },
  {
    // Not in the rail. Kept as a hub so `/dashboard/apps` keeps its title,
    // breadcrumb and ⌘K entry.
    to: '/dashboard/apps',
    label: 'Apps',
    icon: WorkflowIcon,
    sidebarIconClassName: 'text-cat-compute/80',
  },
  {
    to: '/dashboard/releases',
    label: 'Releases',
    icon: Rocket,
    sidebarIconClassName: 'text-cat-compute/80',
    pageOwnsNavigation: true,
    sections: [
      { to: '/dashboard/releases', label: 'Deployments', icon: Rocket },
      { to: '/dashboard/builds', label: 'Builds', icon: Package },
    ],
  },
  {
    to: '/dashboard/jobs',
    label: 'Jobs',
    icon: Play,
    sidebarIconClassName: 'text-cat-compute/80',
    pageOwnsNavigation: true,
    sections: [
      { to: '/dashboard/jobs', label: 'Jobs', icon: Play },
      {
        to: '/dashboard/jobs',
        label: 'Automations',
        icon: WorkflowIcon,
        search: { section: 'automations' },
      },
      { to: '/dashboard/crons', label: 'Cron Jobs', icon: Timer },
      { to: '/dashboard/triggers', label: 'Triggers', icon: Antenna },
    ],
  },
  {
    // The microVMs that run apps: compute you can see, not a way of watching it.
    to: '/dashboard/instances',
    label: 'Instances',
    icon: Server,
    sidebarIconClassName: 'text-cat-compute/80',
  },
  {
    // Not "Storage": the heading above already says that word. The page also
    // carries the app-capacity meter, and its description says so.
    to: '/dashboard/storage',
    label: 'Object storage',
    icon: HardDrive,
    sidebarIconClassName: 'text-cat-storage/80',
  },
  {
    to: '/dashboard/postgres',
    label: 'Postgres',
    icon: Database,
    sidebarIconClassName: 'text-cat-storage/80',
  },
  {
    to: '/dashboard/domains',
    label: 'Domains',
    icon: Globe,
    sidebarIconClassName: 'text-cat-network/80',
  },
  {
    // The account view: every app's rules plus CORS presets. The per-app view
    // is the app page's Connect tab. The label matches APP_TABS, so ⌘K and the
    // breadcrumb list the page once.
    to: '/dashboard/edge-rules',
    label: 'Edge rules',
    icon: FilterList,
    sidebarIconClassName: 'text-cat-network/80',
  },
  {
    // Account-wide: the event router has no per-app read for its backlog,
    // storage, or receipts, so this is its own hub rather than an app tab.
    to: '/dashboard/events',
    label: 'Events',
    icon: DataTransferBoth,
    sidebarIconClassName: 'text-cat-network/80',
  },
  {
    // Outbound integrations are account-owned; apps bind to them, but the
    // integration, its credential, and its budget exist once per account.
    to: '/dashboard/integrations',
    label: 'Integrations',
    icon: Network,
    sidebarIconClassName: 'text-cat-network/80',
  },
  {
    // Your end customers across apps (platform tenants). Monetize rather than
    // Account: they are resources you run — consumers, hostnames, prices —
    // not settings of your own Gregale account, and Billing there is what
    // Gregale charges you, not what you charge them.
    to: '/dashboard/customers',
    label: 'Customers',
    icon: Community,
    sidebarIconClassName: 'text-cat-network/80',
  },
  {
    to: '/dashboard/analytics',
    label: 'Analytics',
    icon: GraphUp,
    sidebarIconClassName: 'text-cat-security/80',
  },
  {
    to: '/dashboard/debug',
    label: 'Debugger',
    icon: Search,
    sidebarIconClassName: 'text-cat-security/80',
  },
  {
    to: '/dashboard/invocations',
    label: 'Invocations',
    icon: Activity,
    sidebarIconClassName: 'text-cat-security/80',
  },
  {
    to: '/dashboard/audit',
    label: 'Audit Log',
    icon: Journal,
    sidebarIconClassName: 'text-cat-security/80',
  },
  {
    to: '/dashboard/usage',
    label: 'Billing',
    icon: GraphUp,
    sections: [
      { to: '/dashboard/usage', label: 'Usage', icon: GraphUp },
      { to: '/dashboard/invoices', label: 'Invoices', icon: Coins },
      { to: '/dashboard/plans', label: 'Plans', icon: CreditCard },
    ],
  },
  {
    to: '/dashboard/settings',
    label: 'Settings',
    icon: Settings,
    sidebarSections: false,
    sections: SETTINGS_SECTIONS.map(([section, label]) => ({
      to: '/dashboard/settings',
      label,
      icon:
        section === 'members'
          ? Group
          : section === 'api-keys'
            ? Key
            : section === 'integrations'
              ? Github
              : section === 'security'
                ? ShieldCheck
                : Settings,
      search: { section },
    })),
  },
];
```

- [ ] **Step 12: Replace `SIDEBAR_GROUPS` and its comment**

Replace the doc comment that starts `/**\n * The sidebar's shape.` and the `const SIDEBAR_GROUPS … = [ … ];` below it with:

```ts
/**
 * The sidebar's shape: account-wide destinations, grouped by the kind of
 * resource they manage.
 *
 * People arriving from other clouds look for a thing by its kind, so the
 * headings are resource categories rather than tasks. Only account-wide pages
 * are rows. Per-app resources (logs, secrets, queues, routes and the rest) are
 * tabs on the app page, where the app is already in the URL; listing them here
 * would ask "which app?" once per row. Reasoning and history:
 * docs/superpowers/specs/2026-10-20-sidebar-categories-design.md.
 *
 * Hubs consolidate pages, not navigation: a hub keeps its sections as nested
 * rows (Billing) unless its page owns them (Jobs, Releases, Settings).
 */
const SIDEBAR_GROUPS: { title?: string; hubs: string[] }[] = [
  { hubs: ['Overview'] },
  { title: 'Compute', hubs: ['Projects', 'Releases', 'Jobs', 'Instances'] },
  { title: 'Storage', hubs: ['Object storage', 'Postgres'] },
  { title: 'Networking', hubs: ['Domains', 'Edge rules'] },
  { title: 'Messaging', hubs: ['Events', 'Integrations'] },
  { title: 'Monetize', hubs: ['Customers'] },
  { title: 'Observe', hubs: ['Analytics', 'Debugger', 'Invocations', 'Audit Log'] },
  { title: 'Account', hubs: ['Billing', 'Settings'] },
];
```

Leave `NAV_GROUPS`, `sidebarSectionsFor` and `isDisclosureHub` as they are.

- [ ] **Step 13: Add `PALETTE_ONLY` and include it in `NAV_ITEMS`**

Directly above `/** Both hub names and familiar page names remain searchable. */`, add:

```ts
/**
 * Destinations ⌘K and the breadcrumb know but the rail does not list. Both
 * redirect into the New app wizard (`?source=template|import`), so a rail row
 * could never be the current page. The New app button is the visible way in.
 */
const PALETTE_ONLY: NavItem[] = [
  { to: '/dashboard/templates', label: 'Templates', icon: Cube },
  { to: '/dashboard/import', label: 'Import', icon: Upload },
];
```

Then change the `NAV_ITEMS` array from:

```ts
export const NAV_ITEMS: NavItem[] = [
  ...NAV_HUBS,
  ...NAV_HUBS.flatMap((hub) => hub.sections ?? []),
  ...APP_SECTIONS,
].filter(
```

to:

```ts
export const NAV_ITEMS: NavItem[] = [
  ...NAV_HUBS,
  ...NAV_HUBS.flatMap((hub) => hub.sections ?? []),
  ...PALETTE_ONLY,
  ...APP_SECTIONS,
].filter(
```

- [ ] **Step 14: Update the comment in `findNavHub`**

In `findNavHub`, replace the comment:

```ts
// Apps live under Projects: the app list, app pages and standalone app
// sections all light the Projects row. Debugger belongs to Observe
// globally, even though it also has an app tab.
```

with:

```ts
// Apps live under Projects: the app list, app pages and standalone app
// sections all light the Projects row. Debugger and Edge rules are rail
// rows of their own, so they match above, before the app-section fallback.
```

Do not change the code in `findNavHub`.

- [ ] **Step 15: Fix the app-sections guard in `secondary-navigation.tsx`**

Without this, every standalone per-app page loses its "App sections" strip, because the old guard returned early for any hub without sections, and Projects no longer has any. Replace the whole `DashboardSecondaryNavigation` function with:

```tsx
export function DashboardSecondaryNavigation() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hub = findNavHub(pathname);
  if (!hub || hub.pageOwnsNavigation) return null;
  // Standalone per-app pages (logs, routes, …) keep their strip. An app
  // section that is also a rail row (Debugger, Edge rules) is the account view
  // there, and the app page's tab is the per-app way in.
  const showAppSections =
    !matchesNavPath(pathname, { to: hub.to, exact: true }) &&
    APP_SECTIONS.some((item) => matchesNavPath(pathname, item));
  // A hub whose sections are nested rows in the rail must not restate them as
  // a tab strip: two controls for one choice, one of which silently scrolls
  // away. Settings keeps its strip — its eight `?section=` panels are the
  // page's own tabs and deliberately stay out of the rail.
  const hubSections = sidebarSectionsFor(hub).length === 0 ? (hub.sections ?? []) : [];
  if (hubSections.length === 0 && !showAppSections) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {hubSections.length > 0 && (
        <SecondaryNavigation label={`${hub.label} sections`} items={hubSections} />
      )}
      {showAppSections && (
        <details open className="min-w-0">
          <summary className="pressable w-fit cursor-pointer rounded-md px-3 py-1 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            App sections
          </summary>
          <SecondaryNavigation label="App sections" items={APP_SECTIONS} />
        </details>
      )}
    </div>
  );
}
```

The imports at the top of the file already include everything used here.

- [ ] **Step 16: Retitle the storage page**

In `src/routes/dashboard.storage.tsx`, inside `StoragePage`, change:

```tsx
<PageHeader title="Storage" description="Your app capacity and private object buckets." />
```

to:

```tsx
<PageHeader title="Object storage" description="Your app capacity and private object buckets." />
```

Run `npx prettier --write src/routes/dashboard.storage.tsx` afterwards and keep whatever line breaks it chooses.

- [ ] **Step 17: Run the tests and confirm they pass**

Run:

```bash
npx vitest run --maxWorkers=8 src/components/dashboard/navigation.test.tsx src/routes/-dashboard.projects.test.tsx src/lib/seo.test.ts src/lib/customer-surface.test.ts src/routes/-dashboard.navigation.test.tsx src/routes/-dashboard.hub-navigation.test.tsx src/routes/-dashboard.settings-hub.test.tsx
```

Expected: PASS, exit code 0, no "Errors" line. If the keyboard test from Step 5 fails because Tab does not reach Postgres, investigate the focus order before changing the test. A tooltip wrapper adding a tab stop between rows would be a real accessibility regression.

- [ ] **Step 18: Update the README bullet**

In `README.md`, replace the bullet that starts `- **Adding a console page:**` (around line 646) with:

```markdown
- **Adding a console page:** create the route file, then add it to
  `components/dashboard/nav-config.ts`. The sidebar, the breadcrumb, and the
  ⌘K palette are all driven from that one config, so the page becomes
  reachable everywhere at once. The sidebar lists account-wide pages only,
  grouped by resource category (Compute, Storage, Networking, Messaging,
  Monetize, Observe, Account). A `/v1/apps/{slug}/…` resource is an app tab
  instead (`APP_TABS`). The reasoning is in
  `docs/superpowers/specs/2026-10-20-sidebar-categories-design.md`.
```

- [ ] **Step 19: Run the static checks on touched files**

Run:

```bash
npx tsc --noEmit && npm run lint && npx prettier --check src/components/dashboard/nav-config.ts src/components/dashboard/secondary-navigation.tsx src/routes/dashboard.storage.tsx src/components/dashboard/navigation.test.tsx src/routes/-dashboard.projects.test.tsx src/lib/seo.test.ts README.md
```

Expected: tsc exits 0; lint reports 0 errors and 4 warnings; Prettier reports all files formatted. If Prettier flags a file, run `npx prettier --write` on that file only.

- [ ] **Step 20: Commit**

```bash
git add src/components/dashboard/nav-config.ts src/components/dashboard/secondary-navigation.tsx src/routes/dashboard.storage.tsx src/components/dashboard/navigation.test.tsx src/routes/-dashboard.projects.test.tsx src/lib/seo.test.ts README.md
git commit -m "feat(console): group the sidebar by resource category

The rail grouped pages by task (Build, Operate, Account), and the seven
Operate rows shared nothing but not being Build. People coming from other
clouds look for a thing by its kind, so the headings are now Compute,
Storage, Networking, Messaging, Monetize, Observe and Account.

Account-wide pages only: per-app resources stay app tabs. Templates and
Import leave the rail for ⌘K, since both redirect into the New app wizard
and could never be the current row. Edge rules gains a row, Instances
moves to Compute, and the Data and Observe hubs become plain rows, leaving
Billing the only disclosure. Storage is relabelled Object storage so the
row does not repeat its heading.

The app-sections strip guard returned early for any hub without sections,
which would have hidden the strip on every standalone per-app page once
Projects lost its sections; it now checks the page instead."
```

---

### Task 2: Let ⌘K find pages by their rail heading

**Files:**

- Modify: `src/components/dashboard/nav-config.ts` (add `railGroupFor` after `NAV_GROUPS`)
- Modify: `src/components/dashboard/command-palette.tsx` (`Command` interface, the nav-command mapping, the scoring in `results`)
- Create: `src/components/dashboard/nav-config.test.ts`
- Test: `src/components/dashboard/navigation.test.tsx`

**Interfaces:**

- Consumes from Task 1: `NAV_GROUPS` with the seven titles; hubs with `to`, `label` and optional `sections`.
- Produces: `export function railGroupFor(item: Pick<NavItem, 'to' | 'label'>): string | undefined` in `nav-config.ts`. `Command` in `command-palette.tsx` gains `keywords?: string`, matched by search and never rendered.

- [ ] **Step 1: Write the unit test for `railGroupFor`**

Create `src/components/dashboard/nav-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { railGroupFor } from './nav-config';

describe('railGroupFor', () => {
  it.each([
    ['/dashboard/projects', 'Projects', 'Compute'],
    ['/dashboard/instances', 'Instances', 'Compute'],
    ['/dashboard/builds', 'Builds', 'Compute'],
    ['/dashboard/postgres', 'Postgres', 'Storage'],
    ['/dashboard/edge-rules', 'Edge rules', 'Networking'],
    ['/dashboard/integrations', 'Integrations', 'Messaging'],
    ['/dashboard/customers', 'Customers', 'Monetize'],
    ['/dashboard/debug', 'Debugger', 'Observe'],
    ['/dashboard/invoices', 'Invoices', 'Account'],
    ['/dashboard/settings', 'Members', 'Account'],
  ])('files %s (%s) under %s', (to, label, heading) => {
    expect(railGroupFor({ to, label })).toBe(heading);
  });

  it.each([
    ['/dashboard', 'Overview'],
    ['/dashboard/apps', 'Apps'],
    ['/dashboard/logs', 'Logs'],
    ['/dashboard/templates', 'Templates'],
  ])('gives %s (%s) no heading', (to, label) => {
    expect(railGroupFor({ to, label })).toBeUndefined();
  });

  it('tells a Settings section apart from the hub of the same name', () => {
    expect(railGroupFor({ to: '/dashboard/settings', label: 'Integrations' })).toBe('Account');
    expect(railGroupFor({ to: '/dashboard/integrations', label: 'Integrations' })).toBe(
      'Messaging'
    );
  });
});
```

- [ ] **Step 2: Write the palette test**

In `src/components/dashboard/navigation.test.tsx`, add this test directly before the final `it.each([...])('opens %s from the command palette without duplicate results', …)`:

```tsx
it.each([
  ['Observe', ['Analytics', 'Debugger', 'Invocations', 'Audit Log']],
  ['Networking', ['Domains', 'Edge rules']],
  ['Storage', ['Object storage', 'Postgres']],
])('finds the pages filed under %s from the command palette', async (heading, labels) => {
  await renderShell();
  const user = userEvent.setup();
  await user.keyboard('{Control>}k{/Control}');
  await user.type(await screen.findByRole('combobox', { name: 'Search commands' }), heading);
  const options = screen.queryAllByRole('option').map((option) => option.textContent);
  expect(options).toEqual(expect.arrayContaining(labels));
  // The heading is a search term, not a destination, and never shows as text.
  expect(options).not.toContain(heading);
});
```

- [ ] **Step 3: Run both tests and confirm they fail**

Run:

```bash
npx vitest run --maxWorkers=8 src/components/dashboard/nav-config.test.ts src/components/dashboard/navigation.test.tsx -t "railGroupFor|filed under"
```

Expected: FAIL. `nav-config.test.ts` fails to import `railGroupFor`. The palette cases fail because "Observe" and "Networking" return no options and "Storage" returns no Postgres. Record the command and failing lines.

- [ ] **Step 4: Add `railGroupFor` to nav-config**

In `src/components/dashboard/nav-config.ts`, directly after the `export const NAV_GROUPS … ;` statement, add:

```ts
/**
 * The rail heading a destination is filed under, so ⌘K can find a page by its
 * category: "Storage" and "Observe" were rows people typed, and are headings
 * now. Undefined for the untitled Overview group and for pages the rail does
 * not list (app sections, Templates, Import, the Apps list).
 */
export function railGroupFor(item: Pick<NavItem, 'to' | 'label'>): string | undefined {
  const same = (other: NavItem) => other.to === item.to && other.label === item.label;
  return NAV_GROUPS.find((group) =>
    group.items.some((hub) => same(hub) || (hub.sections ?? []).some(same))
  )?.title;
}
```

- [ ] **Step 5: Add `keywords` to palette commands**

In `src/components/dashboard/command-palette.tsx`:

Change the import from `./nav-config` to:

```ts
import { NAV_ITEMS, railGroupFor, SECTION_LABELS, type NavIcon } from './nav-config';
```

In `interface Command`, after `hint?: string;`, add:

```ts
  /** Matched like `hint`, never rendered: a word a page is filed under. */
  keywords?: string;
```

In the `NAV_ITEMS.map((item) => ({ … }))` block that builds the "Go to" commands, add after `group: 'Go to',`:

```ts
        keywords: railGroupFor(item),
```

In the `results` memo, change:

```ts
const onHint = command.hint ? fuzzyMatch(command.hint, q) : null;

const best = Math.max(
  onLabel?.score ?? -Infinity,
  (onGroup?.score ?? -Infinity) - 20,
  (onHint?.score ?? -Infinity) - 30
);
```

to:

```ts
const onHint = command.hint ? fuzzyMatch(command.hint, q) : null;
const onKeywords = command.keywords ? fuzzyMatch(command.keywords, q) : null;

const best = Math.max(
  onLabel?.score ?? -Infinity,
  (onGroup?.score ?? -Infinity) - 20,
  (onHint?.score ?? -Infinity) - 30,
  (onKeywords?.score ?? -Infinity) - 30
);
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run:

```bash
npx vitest run --maxWorkers=8 src/components/dashboard/nav-config.test.ts src/components/dashboard/navigation.test.tsx
```

Expected: PASS, exit code 0, no "Errors" line. The existing palette tests still pass because keywords never change an option's text.

- [ ] **Step 7: Run the static checks on touched files**

Run:

```bash
npx tsc --noEmit && npm run lint && npx prettier --check src/components/dashboard/nav-config.ts src/components/dashboard/nav-config.test.ts src/components/dashboard/command-palette.tsx src/components/dashboard/navigation.test.tsx
```

Expected: tsc exits 0; lint 0 errors and 4 warnings; Prettier clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/dashboard/nav-config.ts src/components/dashboard/nav-config.test.ts src/components/dashboard/command-palette.tsx src/components/dashboard/navigation.test.tsx
git commit -m "feat(console): find pages by their sidebar heading in ⌘K

Data and Observe were rail rows, so typing either in the palette opened a
page. After the regroup they are headings, and the search would have come
back empty. Palette commands now carry the rail heading as an unrendered
keyword, matched at the same discount as a hint, so \"Observe\" lists
Analytics, Debugger, Invocations and Audit Log, and \"Storage\" finds
Postgres as well as Object storage. Option text is unchanged."
```

---

### Task 3: Verify the branch and walk the rail

No code changes unless a check fails. This task produces the evidence for the PR.

**Files:**

- None, unless Step 4's fallback is needed: then `src/components/dashboard/shell.tsx` (one class), which needs the user's approval first because the spec says `shell.tsx` does not change.

**Interfaces:**

- Consumes: Tasks 1 and 2 committed.
- Produces: a verification report with the numbers below.

- [ ] **Step 1: Run the full gate**

Run each and record the result:

```bash
npx tsc --noEmit
```

```bash
npm run lint
```

```bash
npm run format:check
```

```bash
npx vitest run --maxWorkers=8
```

```bash
npm run build
```

Expected: tsc exit 0; lint 0 errors and 4 warnings; format clean; vitest exit 0 with no "Errors" line (record file and test counts); build succeeds and lists its prerendered routes. If any fail, fix in the task that owns the file and commit there, then rerun all five.

- [ ] **Step 2: Start the mock console**

Run in the background:

```bash
npm run dev:mock
```

Wait for Vite's "ready" line, then open `http://localhost:3000/dashboard`.

- [ ] **Step 3: Walk the rail**

At a 1366×768 window, check and record each:

1. Headings read Compute, Storage, Networking, Messaging, Monetize, Observe, Account, in that order, with rows as in the spec.
2. Each of the 20 rows, clicked, lights itself and only itself.
3. `/dashboard/apps/<any seeded app>` and `/dashboard/logs` light Projects. `/dashboard/logs` still shows "App sections".
4. `/dashboard/edge-rules` and `/dashboard/debug` light their own rows and show no "App sections".
5. ⌘K finds Templates, Import and Object storage by name, and "Observe" lists its four pages.
6. The page title of `/dashboard/storage` reads "Object storage · Gregale", and its header says "Object storage".
7. ⌘B collapses the rail: icons only, a hairline per heading, tooltips carry the names.
8. The mobile drawer at 390px wide shows the same rows.

- [ ] **Step 4: Measure the rail height against main**

In the browser console on `/dashboard`, run:

```js
document.querySelector('nav[aria-label="Main"]').scrollHeight;
```

Record the value. Then, in the worktree, run `git switch --detach origin/main`, reload, run the same line, and record that value. Return with `git switch feat/console-sidebar-categories` and reload.

Pass: the new value is no more than 120px above main's (the spec estimates about 70px). If it is more, stop and report both numbers. The spec's fallback is changing `gap-4` to `gap-3` on the `<nav aria-label="Main">` in `shell.tsx`, which needs approval because the spec otherwise leaves `shell.tsx` untouched.

- [ ] **Step 5: Run the tour, or say why not**

Playwright is not installed in this worktree. Run:

```bash
BASE_URL=http://localhost:3000 npm run tour
```

If it prints the Playwright install line, do not install anything. Record "tour not run: Playwright not installed" in the report. If it runs and fails only on `/v1/apps/{slug}/buckets` (`not_mocked`), that failure exists on main too; record it as pre-existing.

- [ ] **Step 6: Stop the dev server and report**

Stop the background dev server. Report: the five gate results with counts, the Step 3 checklist with any deviations, both Step 4 heights, the Step 5 outcome, and anything noticed but not changed. Known and out of scope: the Edge rules page header says "Edge Rules" while the rail says "Edge rules".

Then hand over to superpowers:finishing-a-development-branch. The PR body must carry the spec's four "Questions for Poyraz", addressed to @poyrazK, marked non-blocking.
