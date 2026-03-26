#!/usr/bin/env bash
# Deploy PickMyFruit to Fly.io with Sentry sourcemap upload.
#
# The vite build runs inside the Docker build on Fly's remote builder.
# SENTRY_AUTH_TOKEN is passed as a BuildKit secret so it is never stored in an
# image layer. sentry-cli uploads sourcemaps and deletes the .map files from
# the output directory during the build.
#
# One-time GitHub repository setup (Settings → Secrets and variables):
#   Secrets:  SENTRY_AUTH_TOKEN   Create at https://sentry.io/settings/auth-tokens/
#             VITE_SENTRY_DSN     Found in Sentry project → Settings → Client Keys
#             FLY_API_TOKEN       Create at https://fly.io/user/personal_access_tokens
#   Variables: SENTRY_ORG         Your Sentry organization slug
#              SENTRY_PROJECT     Your Sentry project slug
#   Note: VITE_SENTRY_ENABLED is already set to "true" via fly.toml [build.args]
#         and does not need to be a GitHub variable.
#
# Required env vars for manual deploys:
#   SENTRY_AUTH_TOKEN   Sentry authentication token
#   SENTRY_ORG          Sentry organization slug
#   SENTRY_PROJECT      Sentry project slug
#   VITE_SENTRY_DSN     Sentry DSN (baked into the JS bundle at build time)
#
# Optional env vars:
#   SENTRY_RELEASE               Git SHA to use as the release name.
#                                Defaults to: git rev-parse HEAD
#                                VITE_SENTRY_RELEASE is derived from this automatically.
#   VITE_SENTRY_ERROR_SAMPLE_RATE    Error sample rate (default: 1.0 in prod)
#   VITE_SENTRY_TRACES_SAMPLE_RATE   Traces sample rate (default: 1.0 in prod)

set -euo pipefail

: "${SENTRY_AUTH_TOKEN:?Required: SENTRY_AUTH_TOKEN}"
: "${SENTRY_ORG:?Required: SENTRY_ORG}"
: "${SENTRY_PROJECT:?Required: SENTRY_PROJECT}"
: "${VITE_SENTRY_DSN:?Required: VITE_SENTRY_DSN}"

RELEASE="${SENTRY_RELEASE:-$(git rev-parse HEAD)}"
SHORT="${RELEASE:0:8}"

APP_LABEL="${FLY_APP:-pickmyfruit}"
echo "=== Deploying $APP_LABEL (release: $SHORT) ==="

DEPLOY_ARGS=(
	--remote-only
	--build-secret "sentry_auth_token=$SENTRY_AUTH_TOKEN"
	--build-arg "VITE_SENTRY_DSN=$VITE_SENTRY_DSN"
	--build-arg "SENTRY_RELEASE=$RELEASE"
	--build-arg "SENTRY_ORG=$SENTRY_ORG"
	--build-arg "SENTRY_PROJECT=$SENTRY_PROJECT"
)

[[ -n "${FLY_APP:-}" ]]    && DEPLOY_ARGS=(--app "$FLY_APP" "${DEPLOY_ARGS[@]}")
[[ -n "${FLY_CONFIG:-}" ]] && DEPLOY_ARGS=(--config "$FLY_CONFIG" "${DEPLOY_ARGS[@]}")
[[ -n "${FLY_HA:-}" ]]     && DEPLOY_ARGS+=(--ha="$FLY_HA")

[[ -n "${VITE_SENTRY_ENVIRONMENT:-}" ]] &&
	DEPLOY_ARGS+=(--build-arg "VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT")

[[ -n "${VITE_SENTRY_ERROR_SAMPLE_RATE:-}" ]] &&
	DEPLOY_ARGS+=(--build-arg "VITE_SENTRY_ERROR_SAMPLE_RATE=$VITE_SENTRY_ERROR_SAMPLE_RATE")

[[ -n "${VITE_SENTRY_TRACES_SAMPLE_RATE:-}" ]] &&
	DEPLOY_ARGS+=(--build-arg "VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE")

flyctl deploy "${DEPLOY_ARGS[@]}"
