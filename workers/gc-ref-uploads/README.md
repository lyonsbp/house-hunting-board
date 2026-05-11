# gc-ref-uploads

Standalone Cloudflare Worker that GCs ephemeral AI-edit reference uploads.

Per PRD §5.3a, reference images uploaded from disk into the AI edit modal
are ephemeral and live under the `ref_uploads/` prefix in the `artifacts`
Supabase Storage bucket. This worker runs daily (07:00 UTC) and removes
anything older than `REF_TTL_HOURS` (default 24h).

## Why a separate worker?

Decouples the service-role key from the request-path Next.js worker. The
main worker only needs the publishable Supabase keys; only this cron
worker holds the admin key. Smaller blast radius if either is leaked.

## Deploy

From this directory:

```bash
# One-time: drop the service-role key
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# Deploy + schedule
wrangler deploy
```

## Test locally

```bash
# Dry sweep against the configured project — uses your wrangler login
# session for service-role secret resolution if you've put it.
wrangler dev --test-scheduled

# Then in another shell:
curl http://localhost:8787/__scheduled?cron=0+7+*+*+*
```

Logs: `wrangler tail --name gc-ref-uploads`.
