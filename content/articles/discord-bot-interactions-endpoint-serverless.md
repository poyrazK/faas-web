**A Discord bot that only answers slash commands does not need a server
running all day: give it an Interactions Endpoint URL, and Discord sends each
command to it as an HTTPS request.** The bot must check the request's
Ed25519 signature and send its first response within 3 seconds. On Gregale,
the endpoint on this page has no dependencies beyond Node.js, wakes from a
parked snapshot in about a quarter of a second, and costs nothing between
commands.

## Gateway or endpoint

Discord delivers interactions one of two ways, never both:

- **Over the Gateway**, a WebSocket your bot keeps open. This is the default,
  and what libraries such as discord.js use. The connection has to stay up,
  so the bot runs all the time.
- **To an Interactions Endpoint URL**, a public HTTPS URL you set in the
  app's settings. Discord sends each slash command, button press or modal
  submission there as a `POST`. Nothing has to run in between.

A bot that reacts to messages, presence or voice needs the Gateway. A bot
whose users only run commands and click components can use the endpoint and
scale to zero.

## The endpoint

The complete project, with tests that sign interactions with a key pair of
their own and a script that registers the commands, is on GitHub as
[gregale-dev/discord-bot-interactions](https://github.com/gregale-dev/discord-bot-interactions).

`package.json`:

```json
{
  "name": "discord-interactions",
  "private": true,
  "type": "module",
  "scripts": { "start": "node server.js" },
  "engines": { "node": ">=22" }
}
```

`server.js`, using Node's built-in Ed25519 support:

```js
import { createServer } from 'node:http';
import { createPublicKey, verify } from 'node:crypto';

const publicKey = createPublicKey({
  key: {
    kty: 'OKP',
    crv: 'Ed25519',
    x: Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex').toString('base64url'),
  },
  format: 'jwk',
});

function signed(req, body) {
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  if (!signature || !timestamp) return false;
  try {
    const message = Buffer.concat([Buffer.from(timestamp), body]);
    return verify(null, message, publicKey, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

function json(res, value) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') return res.end('ok');
  if (req.method !== 'POST' || req.url !== '/interactions') {
    return res.writeHead(404).end();
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  if (!signed(req, body)) return res.writeHead(401).end('invalid request signature');

  const interaction = JSON.parse(body);
  if (interaction.type === 1) return json(res, { type: 1 }); // PING -> PONG
  if (interaction.type === 2 && interaction.data.name === 'ping') {
    return json(res, { type: 4, data: { content: 'pong' } });
  }
  res.writeHead(400).end();
}).listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
```

What Discord requires, and where the code does it:

- **Verify every request.** Each one carries `X-Signature-Ed25519` and
  `X-Signature-Timestamp`. The signature covers the timestamp followed by the
  raw body, and a request that fails the check must get `401`.
- **Answer `PING` with `PONG`.** When you save the endpoint URL, Discord
  sends a `PING` (`type: 1`) and expects `200` with `{"type": 1}`. Discord
  does not accept the URL until both of these work.
- **Respond within 3 seconds.** Type `4` answers with a message right away.
  If the first response is late, Discord invalidates the interaction's token.

## Deploy it and connect Discord

Gregale runs the app with `npm run start` and listens where `PORT` says. Make
it public in `gregale.yaml`, because Discord cannot send a Gregale API key:

```yaml
access: public
```

Copy your app's **Public Key** from the Discord Developer Portal into a
secrets file, and deploy:

```bash
echo "DISCORD_PUBLIC_KEY=<public key>" > ../discord.secrets
gregale deploy --name my-discord-bot --secrets-file ../discord.secrets
```

On the app's **General Information** page, set the endpoint URL to
`https://my-discord-bot.gregale.app/interactions`. Then register the
`/ping` command once, with your application ID and bot token:

```bash
curl -X POST "https://discord.com/api/v10/applications/$APPLICATION_ID/commands" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "ping", "type": 1, "description": "Replies with pong"}'
```

The bot token is only for registering commands from your machine; the
endpoint itself needs only the public key.

## Commands that take longer than 3 seconds

Answer with type `5`, which shows the user a loading state, and finish the
work afterwards. Then edit the reply with
`PATCH /webhooks/<application_id>/<interaction_token>/messages/@original`.
The interaction token is valid for 15 minutes.

On Gregale the work after the response keeps going: the instance keeps
running while it works, and the reply to a call your app made resumes a
paused instance. In our test, a 4-second outbound call started after the
response finished in 4.3 seconds, without waiting for another request.

## What we measured

We deployed this code on Gregale on 2026-11-27 and sent it interactions
signed with our own key pair, after letting it park:

- **Memory:** 68 MB while serving, inside the Free plan's 256 MB.
- **Wake from a parked snapshot:** Gregale's wake timeline showed the
  instance running 155 ms into the wake and the first byte of the `PONG` at
  227 ms, far inside Discord's 3 seconds.
- **A request with a bad signature** got `401`.

About a second after each interaction, with nothing in flight, Gregale
pauses the instance, and paused seconds are not billed. If no one runs a
command for a while, it parks to a snapshot.

## If you need the Gateway

A bot that holds the Gateway open has to run all the time. On Gregale that
is a background worker, billed for every hour: a 256 MB worker running a
30-day month uses about 180 GB-RAM-hours, inside the 200 that the Hobby plan
includes. You can also split the two: the endpoint for commands, scaling to
zero, and a small worker only for the Gateway events you need.

## How other platforms handle it

| Platform                      | Idle endpoint                                               | First command after idle                                              |
| ----------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| **Gregale**                   | Paused, then parked to a snapshot; neither billed           | 227 ms to first byte in our test                                      |
| Cloudflare Workers            | Discord's own tutorial hosts an interactions bot on Workers | Not covered by the tutorial                                           |
| Render (Free web service)     | Spins down after 15 minutes without inbound traffic         | About one minute to spin up, past the 3-second limit                  |
| Fly.io (`auto_stop_machines`) | Stopped, or suspended with `"suspend"`                      | About 2 seconds or more stopped; a few hundred milliseconds suspended |

On Gregale the endpoint is an ordinary Node.js, Python or Go app in its own
microVM, so it can use any library its runtime supports.

Sources, checked 2026-11-27:
[Discord: interactions overview](https://docs.discord.com/developers/interactions/overview),
[Discord: receiving and responding](https://docs.discord.com/developers/interactions/receiving-and-responding),
[Discord: application commands](https://docs.discord.com/developers/interactions/application-commands),
[Discord: hosting on Cloudflare Workers](https://docs.discord.com/developers/tutorials/hosting-on-cloudflare-workers),
[Render free instances](https://render.com/docs/free),
[Fly.io autostop/autostart](https://fly.io/docs/launch/autostop-autostart/).

## Pricing

An interactions endpoint fits the Free plan: one app, 256 MB, and 20
included GB-RAM-hours a month, billed only while it handles commands. A
Gateway worker needs a paid plan to run all month. See
[Gregale pricing](/pricing) and
[How scaling to zero works](/docs/scale-to-zero).
