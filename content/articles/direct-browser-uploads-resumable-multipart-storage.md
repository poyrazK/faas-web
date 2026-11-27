**Accept direct browser and mobile file uploads on your app's own domain without waking your backend microVM—and resume multi-gigabyte transfers cleanly when connections drop.** On Gregale, policy-controlled upload routes validate size limits, MIME allowlists, and `Idempotency-Key` headers at the edge while streaming straight to private storage, and resumable multipart uploads split large files into verified parts up to `10,000` pieces.

## Why proxy uploads wake idle backends and leak S3 edge cases

On a traditional PaaS, browser uploads either stream through your application server—keeping containers awake, burning RAM, and timing out on large payloads—or force you to build custom AWS IAM policies, Bucket CORS JSON, and presigned URL endpoints with SDK checksum traps.

When a backend wakes just to read bytes and forward them to S3, every slow mobile upload holds a billable microVM instance open for the duration of the transfer.

## Edge upload routes that never wake your app

Create an authenticated upload route on your app's hostname with `POST /v1/apps/{app}/upload-routes`:

```json
{
  "name": "avatar",
  "bucket_id": "bkt_...",
  "key_prefix": "avatars",
  "max_bytes": 5242880,
  "allowed_content_types": ["image/*"]
}
```

Clients send `POST /uploads/avatar` on your app's own domain with an API key that holds `storage:write`. The route handles the write at the edge:

- **Zero backend wake:** Gregale's public edge checks credentials, enforces `max_bytes` and `allowed_content_types`, and streams straight to the bucket without booting your app.
- **No bucket grant needed:** The key needs no separate bucket grant; each key's uploads isolate cleanly under its own key ID beneath `key_prefix`.
- **Safe retries and receipts:** Pass an `Idempotency-Key` header (up to `128` bytes; conflicting metadata returns `409`) so retries never store duplicate files, and poll `GET /uploads/avatar/receipts/{id}` for status.
- **Active-content safety:** Wildcards such as `image/*` never admit `HTML`, `SVG`, `XML`, `XSL`, or `JavaScript` types; active types must be listed explicitly and are refused with `415` on public bucket mounts so user uploads cannot serve scripts on your origin.

## Signed URLs and resumable multipart uploads

For direct client uploads without passing a Gregale API key to the browser, issue a short-lived signed PUT URL (`gregale bucket sign` or `POST /v1/apps/{app}/buckets/{bucket-id}/signed-url`):

```sh
gregale bucket sign my-api BUCKET_ID avatars/42.png \
  --method PUT \
  --size-bytes 18231 \
  --content-type image/png \
  --expires 15m
```

- Signed URLs default to `5` minutes and last at most `15` minutes (`1,024` unused signed URLs per bucket max).
- Every PUT URL pins exact `size_bytes` and is write-once: retrying after success returns the saved result instead of overwriting.

For large files past the `64 MiB` single-request limit, use resumable multipart uploads via `POST /v1/apps/{app}/buckets/{bucket-id}/multipart-uploads`, sign each part with `POST .../multipart-uploads/{upload-id}/parts/{part}/signed-url`, and finish with `POST .../complete` (or `gregale bucket upload --resume UPLOAD_ID` from the CLI). Unfinished multipart uploads stay resumable for `24` hours across up to `10,000` parts (`64 MiB` max per part through `https://s3.gregale.dev`).

## Avoiding AWS SDK browser-upload traps

Gregale exposes an S3 Signature Version 4 endpoint at `https://s3.gregale.dev` (region `us-east-1`, path-style addressing). When presigning browser PUT URLs with newer S3 SDKs (`@aws-sdk/client-s3` v3 or `boto3` 1.36+), set two options so browser uploads are not rejected:

```js
import { S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: 'https://s3.gregale.dev',
  region: 'us-east-1',
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});
```

1. **`forcePathStyle: true`:** Sends requests to `https://s3.gregale.dev/{bucket}/{key}` rather than a nonexistent `{bucket}.s3.gregale.dev` subdomain.
2. **`requestChecksumCalculation: "WHEN_REQUIRED"`:** Newer SDKs otherwise sign an empty-body CRC32 checksum into presigned PUTs, causing real browser uploads to fail checksum validation. Keep parallel part uploads at `4` (`queueSize: 4`) to stay clear of `503 SlowDown`.
3. **PUT, not presigned POST:** Gregale accepts signed PUT URLs rather than multipart S3 HTML form POST policies.

## CORS rules and reusable CORS presets

Configure per-bucket CORS rules (`gregale bucket cors set my-api BUCKET_ID cors.json`, up to `100` rules per bucket) in preview, or define reusable account and app-scoped policies with **CORS presets** (`POST /v1/cors-presets`, `gregale edge cors`, in beta on Hobby, Pro, and Scale). CORS presets reject combining `AllowCredentials: true` with `*` origins at creation time (`cors_wildcard_with_credentials`), preventing accidental credentialed wildcard rules.

## Plan storage, requests, and egress ceilings

| Plan  | Included storage | Storage ceiling | Monthly requests | Monthly egress |
| ----- | ---------------: | --------------: | ---------------: | -------------: |
| Free  |            1 GiB |           1 GiB |           50,000 |         10 GiB |
| Hobby |           10 GiB |          20 GiB |          500,000 |        100 GiB |
| Pro   |           50 GiB |         250 GiB |        2,500,000 |        500 GiB |
| Scale |          200 GiB |       1,000 GiB |       10,000,000 |      2,000 GiB |

Paid plans bill extra average storage at `$0.03` per GiB-month up to your plan ceiling or spend cap; Free plans stop writes at `1 GiB` with zero overage risk. Bucket upload routes, signed URLs, and multipart uploads are **generally available**; bucket CORS rules are in **preview** and reusable CORS presets are in **beta** (Hobby, Pro, and Scale).

## How other platforms compare

| Capability                         | Gregale                                                               | AWS S3 + API Gateway / Lambda                          | Cloudflare R2                                     |
| ---------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| Authenticated edge upload proxy    | Built-in `POST /uploads/{name}` with MIME/byte enforcement & receipts | Build your own Lambda signer or proxy                  | Put a custom Worker in front of R2                |
| Short-lived signed PUT & multipart | Built-in API + CLI (`5–15` min URLs, `10,000` parts, `--resume`)      | Built-in SigV4 presigned URLs (up to `7` days via IAM) | Built-in S3-compatible presigned URLs (`1`s–`7`d) |
| Active SVG/HTML MIME guard         | Blocks active types under wildcards (`image/*`) automatically         | Must implement in application/WAF logic                | Must implement in custom Worker logic             |
| Bucket & app wiring                | Single `gregale add bucket` command + sealed env secrets              | Write IAM roles, bucket policies, CORS XML/JSON        | Create Worker bindings or S3 API tokens manually  |

Sources, checked 2026-11-27:
[AWS S3 Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-urls.html),
[AWS S3 Multipart Upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/uploadobjusingmpu.html),
[Cloudflare R2 Presigned URLs](https://developers.cloudflare.com/r2/data-access/s3-api/presigned-urls/).

## Pricing and docs

Object storage is included on every plan from Free upward, with extra average storage billed at `$0.03` per GiB-month on paid plans. See [Gregale pricing](/pricing), [Object storage](/docs/object-storage), [Storage](/docs/storage), and [Upload routes & storage API](/docs/api/uploads).
