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

Do not submit market-price ticks, odds changes, comments, analytics endpoints,
image URLs, or unchanged pages that are already marked `noindex`. Submit a URL
once when it changes to `noindex`, redirects, or is deleted so search engines
can discover the removal. IndexNow reports changes to participating search
engines; it does not guarantee crawling or indexing.

Official references:

- https://www.bing.com/indexnow/getstarted
- https://www.indexnow.org/documentation
- https://opennext.js.org/cloudflare/howtos/env-vars
- https://developers.cloudflare.com/workers/configuration/secrets/
