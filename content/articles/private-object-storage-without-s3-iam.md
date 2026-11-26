**Store user uploads, reports, and build artifacts in private S3-compatible buckets bound straight to your app—without AWS IAM policy JSON, S3 egress billing surprises, or waking idle microVMs on uploads.** One CLI command creates the bucket, injects sealed credentials, and integrates with signed URLs, direct upload routes, and async triggers.

## Why S3 setups slow down app teams

Wiring AWS S3 or Cloudflare R2 to a PaaS app typically requires writing IAM users, bucket policies, CORS rules, presigned upload handlers in backend routes (forcing cold starts on every file upload), and manual credential rotation scripts—plus calculating per-GB transfer pricing outside your hosting bill.

## One-command private buckets and standard S3 compatibility

Provision a private bucket and bind it cleanly to your app and environment:

```sh
gregale add bucket assets --app my-api --env production
gregale app binding object-storage rotate my-api assets BINDING_ID --wait
```

Binding injects six sealed environment secrets (`<PREFIX>_ENDPOINT`, `_REGION`, `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_ADDRESSING_STYLE`) that **do not count toward your per-app secret limit**. Any AWS S3 SDK or CLI works out of the box against `https://s3.gregale.dev` (`region: us-east-1`, path-style addressing, SigV4, up to `64 MiB` per single request/part and `10,000` multipart parts).

| Plan  | Included storage | Storage ceiling | Monthly requests | Monthly egress |
| ----- | ---------------: | --------------: | ---------------: | -------------: |
| Free  |            1 GiB |           1 GiB |           50,000 |         10 GiB |
| Hobby |           10 GiB |          20 GiB |          500,000 |        100 GiB |
| Pro   |           50 GiB |         250 GiB |        2,500,000 |        500 GiB |
| Scale |          200 GiB |       1,000 GiB |       10,000,000 |      2,000 GiB |

Paid plans bill additional average storage at `$0.03` per GiB-month up to the plan ceiling (bounded further by your spend cap), while downloads and requests inside plan limits are not billed separately. Free plans stop writes at `1 GiB` with zero overage risk.

## Browser uploads and triggers without waking your app

- **Upload routes (`POST /uploads/avatar`):** Validate size, `Idempotency-Key`, and exact MIME types at the gateway (`allowed_content_types`), blocking active HTML/SVG payloads under wildcards like `image/*` while writing directly to storage without waking your microVM.
- **Short-lived signed URLs:** `gregale bucket sign my-api BUCKET_ID avatars/42.png --method PUT` issues 5-to-15-minute write-once URLs directly against `s3.gregale.dev`; bucket upload triggers in `gregale.yaml` then wake your handler asynchronously only after the upload finishes.
- **Public asset mounts (`--public --serve-at /assets`):** Serve static CDN-cached assets (`5`-minute TTL, zero app compute) on your own domain while user uploads stay isolated in private buckets with sandboxing CSP headers.

## Tradeoffs and region limitations

Gregale object storage currently runs in one region backed by OVHcloud Object Storage without cross-region replication, object versioning, or Object Lock enabled yet in this region—so keep independent copies of irreplaceable files you cannot recreate. Versioning, lifecycle rules, Object Lock, bucket encryption settings, bucket CORS rules, API-key grants, and prefix-scoped `key_prefix` bindings are currently in per-account preview.

See [Object storage](/docs/object-storage), [Storage](/docs/storage), [Plans](/docs/plans), [Hard cloud spend caps that actually stop runaway bills](/articles/hard-cloud-spend-caps), and [Gregale pricing](/pricing).
