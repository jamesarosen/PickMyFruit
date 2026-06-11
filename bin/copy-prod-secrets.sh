#!/usr/bin/env bash
# ⚠️  Agents/automation: EXECUTING this script reads the REAL production
# environment — it runs `flyctl ssh console -a pickmyfruit -C printenv`, pulling
# every production secret over SSH. Do NOT run it to "smoke-test" a change.
#   • To exercise the logic, use `--dry-run` (contacts no app) or put a stub
#     `flyctl` first on a locked-down PATH so the real binary is unreachable.
#   • Before ANY run that could reach a live app, you MUST get the user's
#     go-ahead AND recommend they `fly auth logout` first, so an accidental real
#     call fails closed (auth error) instead of reading production.
# A runtime guard enforces this: reading the source app aborts unless stdin is a
# TTY or --yes is passed (see below). The comment is the reminder; the guard is
# the control.
#
# Copy selected environment variables from the production app to a preview app.
#
# The most common use case is switching a preview app's email provider to Resend
# (the production default), which requires EMAIL_PROVIDER, RESEND_API_KEY, and
# EMAIL_FROM. That is the default selection.
#
# Values are read from production with `flyctl ssh console -C printenv` and piped
# directly into `flyctl secrets import` on the target app. They are never written
# to stdout, stderr, a file, or a process argument: only variable NAMES are
# printed. (`flyctl secrets import` reads NAME=VALUE pairs from stdin, so values
# never appear in argv either.)
#
# The VALUE copied is whatever the variable holds in the source app. The presets
# do not force a value: if EMAIL_PROVIDER is not "resend" in the source, the
# preview app inherits that other value. Multi-line values are not supported
# (every variable these presets target is single-line); a multi-line value would
# be silently truncated at its first newline.
#
# By default `flyctl secrets import` triggers a redeploy of the target app. Use
# --stage to write the secrets without redeploying (apply later with
# `flyctl secrets deploy`).
#
# Usage:
#   bin/copy-prod-secrets.sh --pr <number>  [SELECTOR ...]
#   bin/copy-prod-secrets.sh --app <name>   [SELECTOR ...]
#
# Options:
#   --pr <number>   Target the preview app pickmyfruit-pr-<number>.
#   --app <name>    Target an app by its full name. Mutually exclusive with --pr.
#   --from <name>   Source app to copy from (default: pickmyfruit).
#   --stage         Write secrets without triggering a redeploy.
#   --dry-run       Print the variables that would be copied, then exit without
#                   contacting either app.
#   --yes           Confirm an intentional read from the source app when stdin
#                   is not a TTY (e.g. a script or agent). Ignored with --dry-run.
#   -h, --help      Show this help.
#
# SELECTOR is either a preset group or an explicit variable name. Presets:
#   resend / email   EMAIL_PROVIDER RESEND_API_KEY EMAIL_FROM   (default)
#   storage          STORAGE_PROVIDER AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY \
#                    AWS_ENDPOINT_URL_S3 BUCKET_NAME MEDIA_ORIGIN
#
# Examples:
#   bin/copy-prod-secrets.sh --pr 264
#   bin/copy-prod-secrets.sh --pr 264 storage
#   bin/copy-prod-secrets.sh --app pickmyfruit-pr-264 resend HMAC_SECRET

# -f (noglob): the script word-splits a few unquoted lists intentionally but
# never globs; disabling pathname expansion stops a selector like `EMAIL*` from
# matching files in the working directory.
set -euf -o pipefail

# Defense in depth: if the caller invoked us with xtrace exported (SHELLOPTS),
# silence it so captured secret values are never echoed by the trace.
{ set +x; } 2>/dev/null

FROM="pickmyfruit"
TARGET=""
STAGE=()
SELECTORS=()
DRY_RUN=0
ASSUME_YES=0

usage() {
	# Print the human-facing comment block as help text, starting at the
	# description (the agent warning block above it is deliberately excluded).
	sed -n '/^# Copy selected/,/^set -e/p' "$0" | sed '/^set -e/d; s/^# \{0,1\}//'
}

# True if the space-delimited list ($1) contains the word ($2).
contains() {
	case " $1 " in
		*" $2 "*) return 0 ;;
		*) return 1 ;;
	esac
}

# Guard against setting the target twice via conflicting flags.
set_target() {
	if [[ -n "$TARGET" ]]; then
		echo "Error: --pr and --app are mutually exclusive." >&2
		exit 2
	fi
}

resolve_preset() {
	case "$1" in
		resend | email)
			echo "EMAIL_PROVIDER RESEND_API_KEY EMAIL_FROM"
			;;
		storage)
			echo "STORAGE_PROVIDER AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_ENDPOINT_URL_S3 BUCKET_NAME MEDIA_ORIGIN"
			;;
		*)
			# Not a preset: treat as a literal variable name.
			echo "$1"
			;;
	esac
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--pr)
			[[ $# -ge 2 ]] || { echo "Error: --pr requires a number" >&2; exit 2; }
			[[ "$2" =~ ^[0-9]+$ ]] || { echo "Error: --pr requires a numeric PR number, got '$2'" >&2; exit 2; }
			set_target
			TARGET="pickmyfruit-pr-$2"
			shift 2
			;;
		--app)
			[[ $# -ge 2 ]] || { echo "Error: --app requires a name" >&2; exit 2; }
			set_target
			TARGET="$2"
			shift 2
			;;
		--from)
			[[ $# -ge 2 ]] || { echo "Error: --from requires a name" >&2; exit 2; }
			FROM="$2"
			shift 2
			;;
		--stage)
			STAGE=(--stage)
			shift
			;;
		--dry-run)
			DRY_RUN=1
			shift
			;;
		--yes)
			ASSUME_YES=1
			shift
			;;
		-h | --help)
			usage
			exit 0
			;;
		-*)
			echo "Error: unknown option '$1'" >&2
			exit 2
			;;
		*)
			SELECTORS+=("$1")
			shift
			;;
	esac
done

if [[ -z "$TARGET" ]]; then
	echo "Error: a target is required (--pr <number> or --app <name>)" >&2
	echo "Run with --help for usage." >&2
	exit 2
fi

# Default to the Resend email selection when no selector is given.
[[ ${#SELECTORS[@]} -eq 0 ]] && SELECTORS=(resend)

# Expand presets into a de-duplicated, sorted set of variable names. WANTED is a
# space-delimited list (bash 3.2 on macOS has no associative arrays).
WANTED=""
for selector in "${SELECTORS[@]}"; do
	expansion=$(resolve_preset "$selector")
	# A literal selector (not a preset) must look like an env var name; this
	# turns a preset typo (e.g. "ressed") into an error instead of a silently
	# skipped variable.
	if [[ "$expansion" == "$selector" ]] && ! [[ "$selector" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
		echo "Error: '$selector' is not a known preset (resend, email, storage) or a valid variable name." >&2
		exit 2
	fi
	for name in $expansion; do
		contains "$WANTED" "$name" || WANTED="$WANTED $name"
	done
done
NAMES=()
while IFS= read -r name; do
	[[ -n "$name" ]] && NAMES+=("$name")
done < <(printf '%s\n' $WANTED | sort)

echo "=== Copying ${#NAMES[@]} variable(s) from '$FROM' to '$TARGET' ==="
printf '  %s\n' "${NAMES[@]}"

if [[ "$DRY_RUN" -eq 1 ]]; then
	if [[ ${#STAGE[@]} -gt 0 ]]; then
		echo "Dry run: would stage these to '$TARGET' (no redeploy). Nothing was read or written."
	else
		echo "Dry run: would import these to '$TARGET' (triggers a redeploy). Nothing was read or written."
	fi
	exit 0
fi

command -v flyctl >/dev/null 2>&1 || {
	echo "Error: flyctl is not installed or not on PATH. See https://fly.io/docs/flyctl/install/" >&2
	exit 1
}

# Fail closed in automation: reading the source app pulls real secrets over SSH.
# Agent and CI shells are typically non-interactive, so an absent TTY on stdin
# blocks an accidental production read by default. A human at a terminal passes
# this automatically; scripts must opt in with --yes. (--dry-run never reaches
# here.)
if [[ ! -t 0 && "$ASSUME_YES" -ne 1 ]]; then
	echo "Error: refusing to read secrets from '$FROM' non-interactively." >&2
	echo "Use --dry-run to preview, or pass --yes to confirm an intentional read." >&2
	exit 2
fi

# Capture the full production environment. This is the only place secret values
# enter the script; they live only in shell variables and are never printed.
if ! PROD_ENV=$(flyctl ssh console -a "$FROM" -C printenv); then
	echo "Error: failed to read environment from '$FROM'" >&2
	exit 1
fi

# Build the NAME=VALUE payload for the wanted variables, tracking any that are
# absent in production so we can report them by name (never by value). Reading
# via process substitution (not a here-string) keeps the captured env off disk:
# bash backs here-strings with a temp file, which can be world-readable.
PAYLOAD=""
FOUND=""
while IFS= read -r line; do
	name=${line%%=*}
	# Skip anything that is not a valid env-var assignment (e.g. connection
	# noise or the continuation line of a multi-line value).
	[[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
	if contains "$WANTED" "$name"; then
		PAYLOAD+="$line"$'\n'
		contains "$FOUND" "$name" || FOUND="$FOUND $name"
	fi
done < <(printf '%s\n' "$PROD_ENV")

MISSING=()
for name in "${NAMES[@]}"; do
	contains "$FOUND" "$name" || MISSING+=("$name")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
	echo "Warning: not set in '$FROM', skipping:" >&2
	printf '  %s\n' "${MISSING[@]}" >&2
fi

if [[ -z "$PAYLOAD" ]]; then
	echo "Error: none of the requested variables are set in '$FROM'; nothing to copy." >&2
	exit 1
fi

# Pipe NAME=VALUE pairs straight into the target app. Values stay on stdin.
printf '%s' "$PAYLOAD" | flyctl secrets import -a "$TARGET" ${STAGE[@]+"${STAGE[@]}"}

FOUND_ARR=($FOUND)
if [[ ${#STAGE[@]} -gt 0 ]]; then
	echo "=== Done. ${#FOUND_ARR[@]} variable(s) staged to '$TARGET'; no redeploy triggered. Apply with 'flyctl secrets deploy -a $TARGET'. ==="
else
	echo "=== Done. ${#FOUND_ARR[@]} variable(s) imported to '$TARGET'; a redeploy was triggered. ==="
fi
