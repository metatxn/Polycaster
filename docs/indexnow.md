# IndexNow operations

Knoww exposes its IndexNow verification response at:

```text
https://knoww.app/indexnow-key.txt
```

The response and the submission script both read `INDEXNOW_KEY` at runtime.
Keep the value out of Git and configure it as a Cloudflare Worker secret.

```bash
cd apps/web
pnpm exec wrangler secret put INDEXNOW_KEY
```

After deploying, confirm the verification route returns HTTP 200 without
printing its response body:

```bash
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  https://knoww.app/indexnow-key.txt
```

Submit only URLs that were added, materially updated, redirected, or deleted
after IndexNow was enabled:

```bash
pnpm --filter @knoww/web indexnow -- \
  https://knoww.app/guides \
  https://knoww.app/events/technology
```

The command requires `INDEXNOW_KEY` in its process environment. It rejects
non-HTTPS URLs, alternate hosts, query strings, fragments, API routes, Next.js
assets, sitemap files, and static assets. Repeated URLs are deduplicated, and
each submission is capped at the protocol limit of 10,000 URLs.

## Automatic hourly submission

The production Cloudflare Worker runs `0 * * * *` (hourly, in UTC). Each run
reads the segmented sitemap, compares it with the previous snapshot in the
`INDEXNOW_STATE` KV namespace, and submits only URLs that were added, removed,
or have a changed `<lastmod>`. Submissions are split into batches of at most
10,000 URLs.

The first successful run stores a baseline and intentionally submits nothing;
IndexNow recommends notifying search engines about changes after integration,
not backfilling unchanged historical URLs. A failed sitemap fetch or IndexNow
submission does not advance the snapshot, so the change is retried on the next
hourly run.

`wrangler.jsonc` declares the KV binding without an ID. On the first CLI
deployment, Wrangler automatically provisions the namespace and writes its ID
back into the configuration. Keep that generated ID in source control. The
`INDEXNOW_KEY` remains a Worker secret and must never be placed in the Wrangler
configuration.

To test the scheduled handler locally after building the OpenNext worker:

```bash
cd apps/web
pnpm exec opennextjs-cloudflare build
pnpm exec wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

Production logs use the structured `indexnow.cron.run.started`,
`indexnow.cron.run.finished`, and `indexnow.cron.run.failed` events. The finish
event reports counts and duration without logging the key or submitted URLs.

Do not submit market-price ticks, odds changes, comments, analytics endpoints,
image URLs, or unchanged pages that are already marked `noindex`. Submit a URL
once when it changes to `noindex`, redirects, or is deleted so search engines
can discover the removal. IndexNow reports changes to participating search
engines; it does not guarantee crawling or indexing.

Official references:

- https://www.bing.com/indexnow/getstarted
- https://www.indexnow.org/documentation
- https://opennext.js.org/cloudflare/howtos/env-vars
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/kv/get-started/
- https://developers.cloudflare.com/workers/configuration/secrets/
