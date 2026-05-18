#!/usr/bin/env bash
# Deploy the app to Cloudflare Workers.
#
# Reads CLOUDFLARE_API_TOKEN from .env.development.local if not already in the
# shell, then runs the OpenNext build + deploy. Other vars from
# .env.development.local are intentionally NOT sourced — Next.js inlines
# `process.env.NEXT_PUBLIC_*` at build time, so leaking localhost-pointed dev
# values into a production build silently produces a worker that talks to
# localhost. `.env.production` is the only file that should provide
# NEXT_PUBLIC_* values for production builds.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]] && [[ -f .env.development.local ]]; then
  token=$(grep -E '^CLOUDFLARE_API_TOKEN=' .env.development.local | head -1 | cut -d= -f2-)
  if [[ -n "${token:-}" ]]; then
    export CLOUDFLARE_API_TOKEN="$token"
  fi
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is not set." >&2
  echo "Set it in your shell or add CLOUDFLARE_API_TOKEN=... to .env.development.local" >&2
  exit 1
fi

# Defensive: refuse to inherit dev-pointing NEXT_PUBLIC_* values from the shell
# (e.g. if the user ran `set -a; . .env.development.local`). Without this,
# Next.js will happily inline `http://localhost:54321` into the production
# bundle and you'll spend an hour wondering why prod login bounces to
# localhost. .env.production is authoritative.
unset NEXT_PUBLIC_SUPABASE_URL
unset NEXT_PUBLIC_SUPABASE_ANON_KEY
unset NEXT_PUBLIC_SITE_URL

# Block .env.local from polluting the build. Next.js loads .env.local in
# EVERY mode except test (yes, including production) and it overrides
# .env.production. Localhost-pointing NEXT_PUBLIC_* values there get
# inlined into the prod bundle — we hit this once: Google OAuth bounced
# to http://localhost:3000 because .env.local had NEXT_PUBLIC_SITE_URL
# pointing at dev. Keep dev creds in .env.development.local instead;
# that file is only loaded when NODE_ENV=development.
if [[ -f .env.local ]] && grep -qE '^NEXT_PUBLIC_.+(localhost|127\.0\.0\.1|:54321|:3000)' .env.local; then
  echo "ERROR: .env.local contains localhost-pointing NEXT_PUBLIC_* values." >&2
  echo "       Move them to .env.development.local — .env.local is loaded" >&2
  echo "       during the production build and will pollute the bundle." >&2
  echo "       Offending lines:" >&2
  grep -nE '^NEXT_PUBLIC_.+(localhost|127\.0\.0\.1|:54321|:3000)' .env.local >&2 || true
  exit 1
fi

pnpm cf:build
pnpm exec opennextjs-cloudflare deploy
