**Gregale parks an idle app as a Firecracker snapshot and restores it when
the next request arrives, and one snapshot is often restored as several VMs
at once.** Restoring is fast: in our published benchmark, 100 restores had a
median of 95 ms and a p95 of 138 ms. But a snapshot is a frozen copy of a
running machine, and copying a running machine also copies the things that
must be unique: its network identity, its random number generators and its
clock. This is what broke for us, and what each restore now does about it.

## Why restore one snapshot many times

An idle app on Gregale holds no memory. About a second after its last request
it pauses, and after 10 minutes it is written to disk as a snapshot: guest
memory, device state and the Firecracker VM state. Its cgroup is gone, so a
parked app costs disk space and nothing else.

When a request arrives, we restore the snapshot instead of booting the app
again. A cold boot of a typical Node service takes seconds, while a restore
takes around 100 ms. If traffic needs more than one instance, the same
snapshot is restored again, so two or more VMs start from identical memory.
The same snapshot is also restored again after every park, possibly hundreds
of times.

Each of those VMs then believes it is the machine that was snapshotted.

## Problem 1: network identity

A snapshot freezes the guest's network configuration: its IP address, routes,
neighbour table and any open sockets. If every VM had its own address, a
snapshot could only ever be restored as the VM that took it, and restoring it
as a second instance would put two VMs on the network with one address.

So we went the other way and gave every guest the same address. Every guest
on Gregale is `10.0.0.2/30` with gateway `10.0.0.1`, behind a `tap0` device.
What changes per instance is the network namespace on the host around it:

- Each instance gets its own namespace, and Firecracker's `tap0` lives inside
  it.
- A veth pair connects the namespace to a host bridge. The host end's address
  is the instance's real, routable identity.
- nftables rules inside the namespace forward inbound traffic to
  `10.0.0.2:8080` and masquerade outbound traffic.

The inside of every VM is identical and the outside is unique, so any snapshot
can be restored as any number of instances on any host.

One side effect surprised users: an app that listens on `127.0.0.1` never
receives traffic, because requests arrive on `10.0.0.2`. We now detect a
loopback-only listener when the app first starts and report it as an error
with the fix (listen on `0.0.0.0`), instead of letting the deploy time out.

## Problem 2: the kernel's random state

The guest kernel's entropy pool and CRNG state are part of the snapshot. Two
VMs restored from one snapshot hold the same CRNG state, and without
intervention they produce the same "random" bytes: the same UUIDs from
`/proc/sys/kernel/random/uuid`, and the same keys for anything generated after
the wake.

We expected virtio-rng to solve this. Every guest has one attached. It
doesn't: the virtio-rng device state is captured in the snapshot too, so two
restores of the same snapshot read the same bytes from `/dev/hwrng`.

So the host supplies the uniqueness. When the host wakes a restored guest, it
sends a resume message over vsock that carries fresh bytes from the host's
CSPRNG. The guest's init process, which is our own static Go binary running as
PID 1:

1. injects the host's bytes with `ioctl(RNDADDENTROPY)`, before anything else
   runs;
2. mixes in more bytes from virtio-rng;
3. calls `ioctl(RNDRESEEDCRNG)` so the CRNG re-keys from the new input
   immediately, instead of at its next scheduled reseed.

A test on real hardware restores one snapshot twice and checks that the two
guests report different UUIDs. If any step fails, the guest refuses to report
ready, because a guest that isn't unique must not serve traffic.

## Problem 3: random state inside processes

Reseeding the kernel turned out to be only half the job. A restored process
resumes with every generator it held in memory at capture time:

- OpenSSL's DRBG, used by Node's `crypto` and Python's `ssl`;
- V8's `Math.random`;
- Python's `random` module;
- Node's internal caches for `randomUUID` and `randomInt`.

None of these read the kernel on every call, so every restore of one snapshot,
and every sibling instance, replays the same sequence. Two instances can hand
out the same session ID or nonce.

Gregale fixes this inside the processes themselves. When init starts the app,
it adds a small preload to every Node process (through `NODE_OPTIONS`) and
every Python process (through `sitecustomize`), and an agent to every JVM.
Each one registers on a local socket. On resume, after the kernel step, init
sends every registered process a fresh nonce and waits for each one to confirm
that it reseeded. Only then does it tell the host the guest is ready.

A process that doesn't confirm fails the resume. The host then discards that
VM and cold-boots the app instead: slower, but never a duplicate. An app can
opt out with `GREGALE_RESTORE_RESEED=off`, and the docs warn that this is
unsafe for any app that generates secrets or nonces.

### Why the timeout keeps moving

This barrier is where most of our restore-time surprises came from. A process
that has just been restored is not really in memory yet: its heap is faulted
back in from the snapshot file as it touches pages. A reply that normally
takes well under a millisecond can take far longer.

- Our first budget was 250 ms. With several restores at once, a Node process
  missed it on about 1 in 20 restores, and each miss turned a 100 ms wake into
  a cold boot of several seconds.
- We raised the budget to 2 seconds and added a mode where Node answers from
  a native thread instead of waiting for its event loop. A miss still fails
  closed. The budget only has to stay far below the cost of a cold boot.
- The JVM is still the slow case. Its reseed reply has taken from 120 ms to
  1.9 seconds on a freshly restored JVM, and a reply past the 2-second budget
  turned one wake into a 30-second cold boot. Removing a full thread stack
  walk from the agent didn't move the numbers, so we are measuring inside the
  agent to find where the time goes.

## Problem 4: the clock

A restored guest wakes up with the wall clock it had at capture time, which
can be minutes or days old. A stale clock breaks TLS certificate validation,
JWT expiry checks, time-based UUIDs and cache TTLs, often in ways that look
like application bugs.

The resume message also carries the host's current time, and init steps the
guest clock to it with `settimeofday` after the entropy step and before
readiness.

Apps get one more chance to fix their own state. They can declare an
after-restore hook, for example to reopen a database connection that was idle
for days, and init calls it before reporting ready. The full resume order is:

1. kernel entropy;
2. clock;
3. reseed every process;
4. the app's after-restore hook, if it has one;
5. report ready to the host.

## Snapshots are a cache

A snapshot only loads on the Firecracker version that made it, and on a
compatible host CPU and kernel. We record the Firecracker version with every
snapshot and treat snapshots as a cache, never as the only copy of an app.
Every app always has either a usable snapshot or a root filesystem it can cold
boot from, and any restore error falls back to a cold boot automatically.

That rule paid off when we moved our compute hosts to different hardware.
Every existing snapshot became unusable at once. Each app cold-booted on its
next request, took a new snapshot, and went back to fast wakes, with nothing
to migrate.

To keep snapshots small, the root filesystem is split across two drives. A
read-only base image is shared by every app on the host, and each app has its
own drive holding only its layer. The guest assembles them with overlayfs.
Flattening them into one image per app would copy the base into every app.

## Numbers

- **Published benchmark:** 100 restores on an SSD-backed node had a median of
  94.8 ms and a p95 of 137.8 ms, for the time from the scheduler starting the
  wake to the guest reporting ready. The per-request samples and the analysis
  script are published with the [benchmark](/research/firecracker-snapshot-restore-ssd-2026-09-09).
- **Bare-metal hosts:** on our current hosts (Xeon E-2388G, NVMe), a minimal
  guest restored in 102 ms at the median and 136 ms at p95, and the guest's
  own resume work took 18 ms at the median. A Node 22 Express app restored in
  117 ms at the median. The largest single phase was waiting for the network
  path, at about 50 ms.
- **Nested virtualization:** the same restores inside cloud VMs with nested
  KVM took several times longer, 480 to 850 ms at the median in production.
  That gap is why we run tenants on bare metal.

## What we would tell someone building this

- **Give every guest the same network identity** and make the host side
  unique. Restoring one snapshot as many VMs depends on it.
- **Don't trust anything inside the snapshot to be unique,** including the
  virtual hardware RNG. The uniqueness has to come from the host at resume
  time.
- **Reseeding the kernel is not enough.** Every language runtime keeps its own
  generators, and the only reliable fix is to reach into each process and
  confirm it reseeded.
- **Fail closed into a cold boot.** A slow wake is a performance problem. Two
  VMs with the same keys is a security problem.
- **Treat snapshots as a cache.** Firecracker upgrades and hardware changes
  will invalidate all of them at once.
