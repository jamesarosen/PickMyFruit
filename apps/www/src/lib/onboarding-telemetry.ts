import { Sentry } from '@/lib/sentry'

/**
 * Onboarding-journey telemetry, all emitted through Sentry.
 *
 * Every event produces both a metric (`Sentry.metrics.count`) for funnel
 * dashboards and a breadcrumb (category `onboarding`) so any error captured
 * mid-journey carries the visitor's step-by-step trail. Event names and
 * attributes are documented in docs/onboarding-telemetry.md — update that
 * file when adding events here.
 */

/** Which audience a home-page call to action addresses. */
export type OnboardingAudience = 'grower' | 'picker'

/** Where on the home page a call to action lives. */
export type OnboardingCtaPlacement = 'hero' | 'how-it-works'

function track(event: string, attributes: Record<string, string>): void {
	Sentry.metrics.count(event, 1, { attributes })
	Sentry.addBreadcrumb({
		category: 'onboarding',
		type: 'info',
		message: event,
		data: attributes,
	})
}

/** Records a click on one of the home page's audience-specific CTAs. */
export function trackOnboardingCtaClick(
	audience: OnboardingAudience,
	placement: OnboardingCtaPlacement
): void {
	track('onboarding.cta.click', { audience, placement })
}

/** Which surface asked Better Auth to send a magic link. */
export type MagicLinkSource = 'login-page' | 'inquiry-form' | 'listing-form'

/** Whether the visitor asked for the first email or a resend. */
export type MagicLinkTrigger = 'initial' | 'resend'

/** Records that a magic-link email was successfully requested. */
export function trackMagicLinkRequested(
	source: MagicLinkSource,
	trigger: MagicLinkTrigger = 'initial'
): void {
	track('onboarding.magic_link.requested', { source, trigger })
}

/**
 * How the visitor completed verification: pasting the token into the waiting
 * screen, or arriving back via the link in the email.
 */
export type MagicLinkMethod = 'manual-token' | 'email-link'

/** Records a successful magic-link verification. */
export function trackMagicLinkVerified(
	source: MagicLinkSource,
	method: MagicLinkMethod
): void {
	track('onboarding.magic_link.verified', { source, method })
}

/**
 * Records a failed token verification. Beyond the funnel metric, this raises
 * a warning-level Sentry message: a visitor who asked to join and could not
 * get in is exactly the kind of drop-off worth alerting on.
 */
export function trackMagicLinkVerifyFailed(source: MagicLinkSource): void {
	track('onboarding.magic_link.verify_failed', { source })
	Sentry.captureMessage('onboarding.magic_link.verify_failed', {
		level: 'warning',
		extra: { source },
	})
}

/**
 * Whether the completing action came from a visitor who authenticated during
 * this flow (`new-session`) or one who was already signed in
 * (`existing-session`).
 */
export type OnboardingAuthState = 'new-session' | 'existing-session'

/** Records an inquiry reaching the owner — the end of the picker funnel. */
export function trackInquirySubmitted(auth: OnboardingAuthState): void {
	track('onboarding.inquiry.submitted', { auth })
}

/** Records a listing being created — the end of the grower funnel. */
export function trackListingSubmitted(auth: OnboardingAuthState): void {
	track('onboarding.listing.submitted', { auth })
}

/**
 * Records a brand-new account. Emitted server-side from Better Auth's
 * user-create hook, so it separates true signups from returning sign-ins,
 * which the client-side magic-link events cannot distinguish.
 */
export function trackUserCreated(): void {
	track('onboarding.user.created', {})
}
