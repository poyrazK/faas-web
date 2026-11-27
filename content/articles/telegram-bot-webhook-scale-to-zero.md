**A Telegram bot can cost nothing while nobody is talking to it if it
receives updates by webhook instead of polling: Telegram then sends each
update to your bot as an HTTPS request, and that request is what starts the
bot.** A polling bot has to keep a process running to ask Telegram for
updates, so on a host that scales to zero it falls asleep and stays asleep.
On Gregale, the webhook bot on this page used 75 MB of memory, fits the Free
plan's 256 MB, and answered from a parked snapshot in a fraction of a second.

## Why bots "fall asleep"

Telegram offers two ways to receive updates, and they are mutually exclusive:

- **Long polling** (`getUpdates`): your bot asks Telegram for new updates,
  again and again. Something has to keep asking, so the process must run all
  the time. On a host that stops idle apps, nothing is left to ask, and the
  bot goes quiet until someone restarts it.
- **Webhooks** (`setWebhook`): Telegram sends each update to an HTTPS URL you
  choose. No process has to run between updates. The incoming request wakes
  the bot.

While a webhook is set, `getUpdates` does not work. Telegram keeps updates
for at most 24 hours until the bot receives them, and if your server answers
with a status other than 2xx, Telegram repeats the request and gives up after
a reasonable number of attempts.

## The bot

A FastAPI app with two files. `requirements.txt`:

```text
fastapi==0.165.0
uvicorn==0.54.0
```

`main.py`:

```python
import hmac
import os

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

app = FastAPI()
SECRET = os.environ["TELEGRAM_WEBHOOK_SECRET"]


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/telegram/webhook")
async def webhook(request: Request):
    sent = request.headers.get("x-telegram-bot-api-secret-token", "")
    if not hmac.compare_digest(sent, SECRET):
        return Response(status_code=401)

    update = await request.json()
    message = update.get("message") or {}
    if "text" not in message:
        return Response(status_code=200)

    # Reply inside the webhook response: no bot token needed here.
    return JSONResponse({
        "method": "sendMessage",
        "chat_id": message["chat"]["id"],
        "text": f"You said: {message['text']}",
    })
```

Two details do the work:

- **The secret header.** When you set the webhook with a `secret_token`,
  Telegram sends it in the `X-Telegram-Bot-Api-Secret-Token` header of every
  update. The bot refuses any request without it, so a stranger who finds the
  URL cannot feed it fake updates.
- **The reply rides on the response.** A webhook response can itself be a
  Bot API call: return JSON with a `method` field and its parameters, and
  Telegram runs it. The bot never needs its bot token. The catch is that you
  cannot see whether that call succeeded; when you need the result, call the
  Bot API yourself with the token, as below.

## Deploy it and set the webhook

Gregale finds FastAPI in `requirements.txt` and starts the app with Uvicorn,
so the project needs no Dockerfile. Make the app public in `gregale.yaml`,
because Telegram cannot send a Gregale API key:

```yaml
access: public
```

Generate the secret, then deploy. Telegram accepts 1 to 256 characters from
`A-Z`, `a-z`, `0-9`, `_` and `-`:

```bash
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
echo "TELEGRAM_WEBHOOK_SECRET=$TELEGRAM_WEBHOOK_SECRET" > ../telegram.secrets
gregale deploy --name my-telegram-bot --secrets-file ../telegram.secrets
```

Point Telegram at the app, with the bot token from BotFather and the same
secret:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url=https://my-telegram-bot.gregale.app/telegram/webhook \
  -d secret_token="$TELEGRAM_WEBHOOK_SECRET"
```

Keep the secrets file out of the repository. To change the secret later, run
`gregale env set --app my-telegram-bot TELEGRAM_WEBHOOK_SECRET=…` and call
`setWebhook` again with the new value.

## What we measured

We deployed this code on Gregale on 2026-11-27 and sent it updates with
Telegram's secret header, after letting it park:

- **Memory:** 75 MB while serving, well inside the Free plan's 256 MB.
- **Wake from a parked snapshot:** Gregale's wake timeline
  (`gregale app wake-timeline`) showed the instance running 92 ms into the
  wake and the first byte of the reply at 166 ms.
- **A request without the secret** got `401` and no reply.

Between updates the bot costs nothing. About a second after a request, with
nothing in flight, Gregale pauses the instance, and paused seconds are not
billed. If the bot stays quiet, it parks to a snapshot, and the next update
restores it.

## When the bot calls the Bot API itself

Sending a photo, several messages or anything whose result you need means
calling `https://api.telegram.org/bot<token>/<method>` from the bot, so add
`TELEGRAM_BOT_TOKEN` to its secrets. You can answer the webhook first and
make the call afterwards: the instance keeps running while it works, and the
reply to a call your app made resumes a paused instance. In our test, a
4-second outbound call started after the response finished in 4.3 seconds,
without waiting for the next request.

## How other platforms handle it

| Platform                      | When the bot is idle                                                             | First update after idle                                               |
| ----------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Gregale**                   | Paused about a second after a request, then parked to a snapshot; neither billed | Restored from the snapshot: 166 ms in our test                        |
| Render (Free web service)     | Spins down after 15 minutes without inbound traffic                              | Spinning back up takes about one minute                               |
| Heroku (Eco dyno)             | Sleeps after 30 minutes without web traffic                                      | Wakes "after a short delay"                                           |
| Fly.io (`auto_stop_machines`) | Stopped, or suspended with `"suspend"`                                           | About 2 seconds or more stopped; a few hundred milliseconds suspended |

Telegram retries an update that fails, so a slow wake delays a reply rather
than losing it. Wherever you host a webhook bot, answer quickly and keep the
handler safe to run twice. Telegram's docs suggest using `update_id` to
ignore repeated updates.

Sources, checked 2026-11-27:
[Telegram Bot API](https://core.telegram.org/bots/api),
[Render free instances](https://render.com/docs/free),
[Heroku Eco dyno hours](https://devcenter.heroku.com/articles/eco-dyno-hours),
[Fly.io autostop/autostart](https://fly.io/docs/launch/autostop-autostart/).

## Pricing

The Free plan runs one app with 256 MB and includes 20 GB-RAM-hours a month,
about 80 hours of a 256 MB instance actually running. A webhook bot runs only
while it handles updates, so most bots stay inside it. See
[Gregale pricing](/pricing), [How scaling to zero works](/docs/scale-to-zero)
and [Deploy FastAPI](/docs/deploy-fastapi).
