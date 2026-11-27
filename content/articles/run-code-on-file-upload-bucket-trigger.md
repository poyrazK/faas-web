**On Gregale, a few lines in `gregale.yaml` make your app run every time a file
lands in a bucket: no Lambda, no queue and no IAM policy to set up.** Add
`triggers` to the bucket entry, deploy, and each matching upload sends your app
one `POST /` with an S3-style event. Your app sleeps until a file arrives, wakes
to process it, and parks again. Bucket triggers are generally available on the
Hobby, Pro and Scale plans.

## Add a trigger

```yaml
# gregale.yaml
buckets:
  - bucket: uploads
    create: true # create the bucket on the first deploy if it doesn't exist
    permission: read_write
    triggers:
      - id: new-image # stable name; renaming it replaces the rule
        prefix: incoming/ # optional
        suffix: .png # optional
```

```bash
gregale deploy
```

On each deploy Gregale makes the bucket's notification rules match the list.
A deploy never changes or deletes an existing bucket.
The same entry binds the bucket to the app, so the app also gets S3
credentials as sealed secrets (`GREGALE_S3_UPLOADS_ENDPOINT`,
`_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` and the rest) to read the new file.

## What your app receives

Each matching write sends one `POST /` to your app as an asynchronous
invocation, with the body AWS S3 events use:

```json
{
  "Records": [
    {
      "eventVersion": "2.1",
      "eventSource": "aws:s3",
      "awsRegion": "…",
      "eventTime": "…",
      "eventName": "ObjectCreated:Put",
      "s3": {
        "configurationId": "…",
        "bucket": { "name": "uploads", "arn": "…" },
        "object": { "key": "incoming%2Fcat.png", "size": 18231, "eTag": "…" }
      }
    }
  ]
}
```

A handler in Python:

```python
from urllib.parse import unquote_plus
from fastapi import FastAPI, Request

app = FastAPI()

@app.post("/")
async def on_upload(request: Request):
    event_id = request.headers["x-gregale-event-id"]  # same across retries
    body = await request.json()
    for record in body["Records"]:
        key = unquote_plus(record["s3"]["object"]["key"])  # keys arrive URL-encoded
        # skip if event_id was already handled, then make the thumbnail,
        # parse the CSV, scan the PDF...
    return {"ok": True}
```

- **Every way of writing counts:** S3 SDKs, signed URLs, upload routes and
  multipart uploads all fire the trigger once the write is confirmed.
- **At least once:** the `x-gregale-event-id` header stays the same across
  retries, so record it before applying side effects. Failed deliveries follow
  the async retry policy and end in the app's dead-letter queue
  (`gregale dlq my-api`).
- **Finish within the request timeout:** each delivery must be answered within
  the app's request timeout, 30 seconds unless you raise it with
  `gregale app my-api --request-timeout 60`, up to 1 minute on Hobby,
  5 minutes on Pro and 15 minutes on Scale. A longer attempt counts as a
  timeout and is retried, so move longer processing into a [job](/docs/jobs).
- **Uploads only:** `events` defaults to every `ObjectCreated` event. Triggers
  don't fire on deletes; use a notification rule for those.
- **Test locally:** `gregale dev` accepts the same `triggers` on
  `dev.buckets`; they call your dev workspace, not production.

## Browser uploads with no "upload finished" call

Your backend hands the browser a signed PUT URL, the browser uploads straight
to `s3.gregale.dev`, and the trigger runs your processing code. The browser
never calls back to say it finished, and your app sleeps while the upload is
in flight.

## Send uploads to a queue or another app

To put each upload on a queue instead of calling the app directly, or to call
an app other than the bucket's owner, set the bucket's notification rules:

```bash
gregale bucket notifications set my-api BUCKET_ID notifications.json
```

Rules also cover deletes, copies, multipart completions and lifecycle
expirations. See [Events and notifications](/docs/object-storage#events-and-notifications).

## How other platforms compare

| Platform             | Run code when a file is uploaded                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Gregale**          | A `triggers` entry in `gregale.yaml`; the app that owns the bucket is called, then scales back to zero                               |
| **AWS**              | S3 event notifications to a Lambda function, SQS, SNS or EventBridge, with IAM permissions for each                                  |
| **Google Cloud Run** | An Eventarc trigger on Cloud Storage events, in the bucket's project and region, with a service account that holds the needed roles  |
| **Cloudflare R2**    | Event notifications to a Queue, consumed by a Worker                                                                                 |
| **Fly.io (Tigris)**  | Tigris object notifications POST to a webhook URL; Fly community answers say private Flycast addresses don't work, so expose the app |
| **Railway**          | Railway Buckets have no event notifications; there is an open feature request for webhooks on upload                                 |

Checked against each vendor's public documentation on November 27, 2026:
[AWS S3 event notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html),
[Cloud Run storage triggers](https://docs.cloud.google.com/run/docs/triggering/storage-triggers),
[Cloudflare R2 event notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/),
[Tigris object notifications](https://www.tigrisdata.com/docs/buckets/object-notifications),
[Fly.io community: Tigris webhooks and Flycast](https://community.fly.io/t/tigris-webhooks-and-flycast/24335),
[Railway Storage Buckets](https://docs.railway.com/storage-buckets),
[Railway feature request](https://station.railway.com/feedback/storage-buckets-object-event-notificati-b9928469).

## Pricing

Triggers run app code, so they need a paid plan (Free answers `402`). There is
no charge per event: your app is billed only for the time it runs to handle
it. Storage beyond each plan's included amount costs $0.03 per GiB-month, and
requests are not billed:

| Plan  | Monthly | Included storage | Storage ceiling |
| ----- | ------: | ---------------: | --------------: |
| Hobby |     $10 |           10 GiB |          20 GiB |
| Pro   |     $30 |           50 GiB |         250 GiB |
| Scale |     $99 |          200 GiB |       1,000 GiB |

See [Gregale pricing](/pricing) and [Object storage](/docs/object-storage#run-code-on-upload).
