import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { TcpListener, UdpListener } from '@/lib/api/listeners';

const access = vi.hoisted(() => ({ value: 'on' as string }));
const tcpList = vi.fn();
const udpList = vi.fn();
const tlsStatus = vi.fn();
const createTcp = vi.fn();
const updateTcp = vi.fn();
const deleteTcp = vi.fn();
const createUdp = vi.fn();
const updateUdp = vi.fn();
const deleteUdp = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();
const app = vi.fn();

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: access.value, refresh: vi.fn() }),
}));
vi.mock('@/lib/api/queries', () => ({
  useApp: (slug: string) => app(slug) as unknown,
  useDomains: () => ({
    data: [
      { domain: 'tcp.example.com', app_id: 'a'.repeat(32), verified: true },
      { domain: 'pending.example.com', app_id: 'a'.repeat(32), verified: false },
      { domain: 'other.example.com', app_id: 'b'.repeat(32), verified: true },
    ],
  }),
}));
vi.mock('@/lib/api/listeners', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/listeners')>()),
  useTcpListeners: (slug: string) => tcpList(slug) as unknown,
  useUdpListeners: (slug: string) => udpList(slug) as unknown,
  useTcpListenerTlsStatus: (slug: string, name: string | null) => tlsStatus(slug, name) as unknown,
  useCreateTcpListener: () => ({ mutateAsync: createTcp, isPending: false }),
  useUpdateTcpListener: () => ({ mutateAsync: updateTcp, isPending: false }),
  useDeleteTcpListener: () => ({ mutateAsync: deleteTcp, isPending: false }),
  useCreateUdpListener: () => ({ mutateAsync: createUdp, isPending: false }),
  useUpdateUdpListener: () => ({ mutateAsync: updateUdp, isPending: false }),
  useDeleteUdpListener: () => ({ mutateAsync: deleteUdp, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { TcpListeners, UdpListeners, listenerFailure } = await import('./listeners');

const mqtt: TcpListener = {
  id: 'l1',
  name: 'mqtt',
  guest_port: 1883,
  public_port: 40001,
  protocol: 'tcp',
  enabled: true,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
  tls: { mode: 'passthrough' },
};
const secure: TcpListener = {
  ...mqtt,
  id: 'l2',
  name: 'mqtts',
  guest_port: 8883,
  public_port: 40002,
  enabled: false,
  tls: { mode: 'terminate', hostname: 'tcp.example.com' },
};
const game: UdpListener = {
  id: 'u1',
  name: 'game',
  guest_port: 7777,
  public_port: 40100,
  protocol: 'udp',
  enabled: false,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
};

const read = <T,>(data: T, extra: Record<string, unknown> = {}) => ({
  data,
  error: null,
  isPending: false,
  refetch: vi.fn(),
  ...extra,
});

const ports = [
  { name: 'mqtt', port: 1883, protocol: 'tcp' },
  { name: 'mqtts', port: 8883, protocol: 'tcp' },
  { port: 5432, protocol: 'tcp' },
  { name: 'admin', port: 9000, protocol: 'tcp', internal: true },
  { name: 'game', port: 7777, protocol: 'udp' },
  { port: 5353, protocol: 'udp' },
];

beforeEach(() => {
  access.value = 'on';
  for (const fn of [
    tcpList,
    udpList,
    tlsStatus,
    createTcp,
    updateTcp,
    deleteTcp,
    createUdp,
    updateUdp,
    deleteUdp,
    confirm,
    toast,
    app,
  ])
    fn.mockReset();
  tcpList.mockReturnValue(read([mqtt, secure]));
  udpList.mockReturnValue(read([game]));
  tlsStatus.mockReturnValue(read(undefined, { isPending: true }));
  app.mockReturnValue(read({ id: 'a'.repeat(32), slug: 'api', manifest: { ports } }));
  confirm.mockResolvedValue(true);
});

describe('TCP listeners', () => {
  it.each(['off', 'plan-not-entitled', 'runtime-unavailable', 'registry-error'])(
    'reads nothing while tcp-listeners is %s',
    (state) => {
      access.value = state;
      render(<TcpListeners slug="api" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(tcpList).not.toHaveBeenCalled();
      expect(app).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /expose port/i })).not.toBeInTheDocument();
    }
  );

  it('shows each listener’s serving state as an icon and a word, with its ports and TLS', () => {
    render(<TcpListeners slug="api" />);
    expect(screen.getByText('Accepting')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('40001')).toBeInTheDocument();
    expect(screen.getByText(/^TLS passthrough/)).toBeInTheDocument();
    expect(screen.getByText(/terminated at the edge for tcp\.example\.com/i)).toBeInTheDocument();
    // Certificate evidence exists only for a terminating listener.
    expect(screen.getAllByRole('button', { name: /certificate status/i })).toHaveLength(1);
  });

  it('offers only the declared, public TCP ports that have no listener yet', () => {
    render(<TcpListeners slug="api" />);
    const select = screen.getByRole('combobox', { name: /declared port/i });
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['tcp-5432 (port 5432)']);
  });

  it('explains that an app with no declared TCP port has nothing to expose', () => {
    app.mockReturnValue(read({ id: 'a'.repeat(32), slug: 'api', manifest: { ports: [] } }));
    render(<TcpListeners slug="api" />);
    expect(screen.getByText(/declares no public TCP ports/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expose port/i })).not.toBeInTheDocument();
  });

  it('says creation puts the port on the internet, and sends nothing when cancelled', async () => {
    confirm.mockResolvedValueOnce(false);
    render(<TcpListeners slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /expose port/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/to the internet/i),
        description: expect.stringMatching(/anyone on the internet/i),
      })
    );
    expect(createTcp).not.toHaveBeenCalled();
    createTcp.mockResolvedValue({ ...mqtt, name: 'tcp-5432', public_port: 40007 });
    await userEvent.type(screen.getByRole('textbox', { name: /public port/i }), '40007');
    await userEvent.click(screen.getByRole('button', { name: /expose port/i }));
    await waitFor(() =>
      expect(createTcp).toHaveBeenCalledWith({
        body: { name: 'tcp-5432', guest_port: 5432, public_port: 40007 },
      })
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: expect.stringMatching(/40007/) })
    );
  });

  it('refuses a public port outside the reserved range before asking', async () => {
    render(<TcpListeners slug="api" />);
    await userEvent.type(screen.getByRole('textbox', { name: /public port/i }), '8080');
    expect(screen.getByText(/whole number from 40000 to 49999/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expose port/i })).toBeDisabled();
  });

  it('needs a hostname to terminate TLS, suggests the app’s verified domains, and says it starts disabled', async () => {
    render(<TcpListeners slug="api" />);
    const form = screen.getByRole('button', { name: /expose port/i }).closest('form')!;
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: /tls/i }),
      'terminate'
    );
    const submit = within(form).getByRole('button', { name: /expose port/i });
    expect(submit).toBeDisabled();
    const options = [...form.querySelectorAll('datalist option')].map((o) =>
      o.getAttribute('value')
    );
    expect(options).toEqual(['tcp.example.com']);
    await userEvent.type(
      within(form).getByRole('combobox', { name: /hostname/i }),
      'tcp.example.com'
    );
    createTcp.mockResolvedValue({ ...secure, name: 'tcp-5432' });
    await userEvent.click(submit);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/starts disabled/i) })
    );
    await waitFor(() =>
      expect(createTcp).toHaveBeenCalledWith({
        body: {
          name: 'tcp-5432',
          guest_port: 5432,
          tls: { mode: 'terminate', hostname: 'tcp.example.com' },
        },
      })
    );
  });

  it('confirms enabling as internet exposure and disabling as keeping the port', async () => {
    updateTcp.mockResolvedValue(mqtt);
    render(<TcpListeners slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/stays reserved/i) })
    );
    await waitFor(() =>
      expect(updateTcp).toHaveBeenCalledWith({ name: 'mqtt', change: { enabled: false } })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/anyone on the internet/i) })
    );
    await waitFor(() =>
      expect(updateTcp).toHaveBeenCalledWith({ name: 'mqtts', change: { enabled: true } })
    );
  });

  it('warns that a TLS change disables the listener and cancels its connections', async () => {
    updateTcp.mockResolvedValue({ ...mqtt, enabled: false });
    render(<TcpListeners slug="api" />);
    await userEvent.click(screen.getAllByRole('button', { name: /change tls/i })[0]);
    const editor = screen.getByRole('button', { name: /save tls/i }).closest('form')!;
    await userEvent.selectOptions(
      within(editor).getByRole('combobox', { name: /tls/i }),
      'terminate'
    );
    await userEvent.type(
      within(editor).getByRole('combobox', { name: /hostname/i }),
      'TCP.example.com'
    );
    await userEvent.click(within(editor).getByRole('button', { name: /save tls/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/disabled and its open connections are cancelled/i),
      })
    );
    await waitFor(() =>
      expect(updateTcp).toHaveBeenCalledWith({
        name: 'mqtt',
        change: { tls: { mode: 'terminate', hostname: 'tcp.example.com' } },
      })
    );
  });

  it('reads certificate evidence only when asked, and treats no evidence as unknown', async () => {
    tlsStatus.mockImplementation((_slug: string, name: string | null) =>
      read(
        name
          ? {
              name,
              tls: secure.tls,
              enabled: false,
              scope: 'observed_edges',
              observations: [
                { edge_id: 'edge-a', status: 'ready', observed_at: '2026-11-03T10:00:00Z' },
                { edge_id: 'edge-b', status: 'unknown', observed_at: '2026-11-03T09:00:00Z' },
              ],
            }
          : undefined
      )
    );
    render(<TcpListeners slug="api" />);
    expect(tlsStatus).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /certificate status/i }));
    expect(tlsStatus).toHaveBeenCalledWith('api', 'mqtts');
    const list = screen.getByRole('list', { name: /certificate evidence/i });
    expect(within(list).getByText('Ready')).toBeInTheDocument();
    expect(within(list).getByText('Unknown')).toBeInTheDocument();
  });

  it('confirms delete as destructive and says the port is released', async () => {
    deleteTcp.mockResolvedValue(undefined);
    render(<TcpListeners slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete mqtt' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/public port 40001 is released/i),
      })
    );
    await waitFor(() => expect(deleteTcp).toHaveBeenCalledWith('mqtt'));
  });

  it('keeps a failed read apart from an empty list', () => {
    tcpList.mockReturnValue(
      read(undefined, {
        error: new ApiError({ status: 503, code: 'capacity', title: 'Briefly at capacity' }),
      })
    );
    render(<TcpListeners slug="api" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/capacity/i);
    expect(screen.queryByText(/no tcp listeners yet/i)).not.toBeInTheDocument();
  });
});

describe('UDP listeners', () => {
  it.each(['off', 'plan-not-entitled'])('reads nothing while udp-listeners is %s', (state) => {
    access.value = state;
    render(<UdpListeners slug="api" />);
    expect(udpList).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /reserve port/i })).not.toBeInTheDocument();
  });

  it('reserves a declared UDP port, saying it starts disabled and what enabling exposes', async () => {
    createUdp.mockResolvedValue({ ...game, name: 'udp-5353', public_port: 40101 });
    render(<UdpListeners slug="api" />);
    const select = screen.getByRole('combobox', { name: /declared port/i });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['udp-5353 (port 5353)']);
    await userEvent.click(screen.getByRole('button', { name: /reserve port/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/starts disabled.*anyone on the internet/i),
      })
    );
    await waitFor(() =>
      expect(createUdp).toHaveBeenCalledWith({ body: { name: 'udp-5353', guest_port: 5353 } })
    );
  });

  it('confirms enabling a UDP listener as internet exposure', async () => {
    updateUdp.mockResolvedValue({ ...game, enabled: true });
    render(<UdpListeners slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/anyone on the internet/i) })
    );
    await waitFor(() => expect(updateUdp).toHaveBeenCalledWith({ name: 'game', enabled: true }));
  });

  it('explains the reservation limit by its code', async () => {
    createUdp.mockRejectedValue(
      new ApiError({ status: 409, code: 'udp_listener_limit', title: 'Limit reached' })
    );
    render(<UdpListeners slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /reserve port/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'UDP listener limit reached' })
      )
    );
  });
});

describe('listenerFailure', () => {
  it('branches on the code, not the status', () => {
    expect(
      listenerFailure(new ApiError({ status: 409, code: 'conflict', title: 'x' }), 'f').title
    ).toMatch(/in use/i);
    expect(
      listenerFailure(new ApiError({ status: 409, code: 'udp_listener_limit', title: 'x' }), 'f')
        .title
    ).toMatch(/limit/i);
    expect(
      listenerFailure(new ApiError({ status: 400, code: 'validation_failed', title: 'x' }), 'Nope')
    ).toMatchObject({ kind: 'error', title: 'Nope' });
  });
});
