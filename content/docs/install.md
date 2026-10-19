# Install the CLI

The `gregale` command is how you deploy, inspect, and operate apps from a terminal. There are two install channels. Both verify what they download.

> Every Gregale release so far is a prerelease. On npm, prereleases publish under the `rc` tag and `latest` is reserved for stable releases, so install `gregale@rc` while the beta is the recommended channel. The commands on this site switch to `latest` only after a stable release has shipped and been verified.

## Choose a channel

| | npm | curl installer |
|---|---|---|
| Command | `npm install -g gregale@rc` | `curl -fsSL https://get.gregale.dev \| sh` |
| Needs | Node.js 18 or newer | `curl` or `wget`, `tar`, and `sha256sum` or `shasum` |
| Verifies | npm integrity and provenance | the release checksum file |
| Pin a version | `npm install -g gregale@0.1.18` | `sh -s -- --version v0.1.18` |
| Best for | a repository that already has a `package.json` | laptops, servers, Dockerfiles |

Supported platforms: macOS (Apple silicon and Intel) and Linux (amd64 and arm64). Windows is not supported; WSL2 works as Linux.

## npm

```bash
npm install -g gregale@rc
```

To run a single command without installing:

```bash
npx gregale@rc deploy
```

The `gregale` package contains a small launcher. The binary for your platform comes from an optional dependency chosen by your operating system and CPU. If the launcher reports a missing platform package, your npm configuration skipped optional dependencies; install with them included:

```bash
npm install -g --include=optional gregale@rc
```

## curl

```bash
curl -fsSL https://get.gregale.dev | sh
```

The script installs to `~/.local/bin` as a normal user, or `/usr/local/bin` as root, and prints a `PATH` hint if that directory is not already on your path. It downloads the release checksum file first and refuses to install an archive that does not match. Re-running it upgrades in place.

Flags go after `sh -s --`:

```bash
curl -fsSL https://get.gregale.dev | sh -s -- --version v0.1.18 --dir /usr/local/bin
```

While no stable release exists the installer falls back to the newest prerelease and says so. Once a stable tag ships it starts preferring that; pass `--version` to stay on a specific release.

To uninstall, remove the one file:

```bash
rm ~/.local/bin/gregale
```

## Manual download

Archives for each platform, the installer script, and a `CLI-SHA256SUMS` file are attached to every [GitHub release](https://github.com/poyrazK/faas/releases). To verify by hand:

```bash
TAG=v0.1.18
ARCHIVE="gregale_${TAG#v}_darwin_arm64.tar.gz"
curl -fsSLO "https://github.com/poyrazK/faas/releases/download/$TAG/$ARCHIVE"
curl -fsSLO "https://github.com/poyrazK/faas/releases/download/$TAG/CLI-SHA256SUMS"
grep " $ARCHIVE\$" CLI-SHA256SUMS | shasum -a 256 -c -     # macOS
grep " $ARCHIVE\$" CLI-SHA256SUMS | sha256sum -c -         # Linux
```

macOS ships `shasum` rather than GNU `sha256sum`, and `shasum` cannot skip entries for archives you did not download, so the sums file is filtered to the one archive first.

## Verify and sign in

```bash
gregale version
gregale login
```

`gregale login` opens a browser to authorise this machine. For CI, use a scoped API key or the GitHub Action instead of a personal login; see [Deploy from your repository](/docs/deploy-from-github).

## In CI

GitHub Actions needs no install. The action vendors the binary:

```yaml
- uses: poyrazK/faas/.github/actions/deploy@v0
  with:
    app: my-app
```

Elsewhere, pin an exact version so a new release cannot change your build:

```dockerfile
RUN curl -fsSL https://get.gregale.dev | sh -s -- --version v0.1.18 --dir /usr/local/bin
```

## Next

- [Deploy your first app](/docs/getting-started): a starter API from install to live URL.
- [CLI completion & man pages](/docs/cli): shell completion and the offline command reference.
