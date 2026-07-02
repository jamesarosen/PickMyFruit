import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCount = vi.fn()
const mockAddBreadcrumb = vi.fn()
const mockCaptureMessage = vi.fn()

vi.mock('@/lib/sentry', () => ({
	Sentry: {
		metrics: { count: mockCount },
		addBreadcrumb: mockAddBreadcrumb,
		captureMessage: mockCaptureMessage,
	},
}))

const {
	trackOnboardingCtaClick,
	trackMagicLinkRequested,
	trackMagicLinkVerified,
	trackMagicLinkVerifyFailed,
	trackInquirySubmitted,
	trackListingSubmitted,
	trackUserCreated,
} = await import('../src/lib/onboarding-telemetry')

beforeEach(() => {
	vi.clearAllMocks()
})

describe('trackOnboardingCtaClick', () => {
	it('counts the click and leaves a breadcrumb naming the audience and placement', () => {
		trackOnboardingCtaClick('picker', 'hero')

		expect(mockCount).toHaveBeenCalledWith('onboarding.cta.click', 1, {
			attributes: { audience: 'picker', placement: 'hero' },
		})
		expect(mockAddBreadcrumb).toHaveBeenCalledWith({
			category: 'onboarding',
			type: 'info',
			message: 'onboarding.cta.click',
			data: { audience: 'picker', placement: 'hero' },
		})
	})
})

describe('trackMagicLinkRequested', () => {
	it('records where the link was requested from, defaulting to the initial send', () => {
		trackMagicLinkRequested('login-page')

		expect(mockCount).toHaveBeenCalledWith('onboarding.magic_link.requested', 1, {
			attributes: { source: 'login-page', trigger: 'initial' },
		})
		expect(mockAddBreadcrumb).toHaveBeenCalledWith({
			category: 'onboarding',
			type: 'info',
			message: 'onboarding.magic_link.requested',
			data: { source: 'login-page', trigger: 'initial' },
		})
	})

	it('distinguishes a resend from the initial send', () => {
		trackMagicLinkRequested('inquiry-form', 'resend')

		expect(mockCount).toHaveBeenCalledWith('onboarding.magic_link.requested', 1, {
			attributes: { source: 'inquiry-form', trigger: 'resend' },
		})
	})
})

describe('trackMagicLinkVerified', () => {
	it('records a successful verification with its source and method', () => {
		trackMagicLinkVerified('inquiry-form', 'manual-token')

		expect(mockCount).toHaveBeenCalledWith('onboarding.magic_link.verified', 1, {
			attributes: { source: 'inquiry-form', method: 'manual-token' },
		})
		expect(mockAddBreadcrumb).toHaveBeenCalledWith({
			category: 'onboarding',
			type: 'info',
			message: 'onboarding.magic_link.verified',
			data: { source: 'inquiry-form', method: 'manual-token' },
		})
	})
})

describe('trackMagicLinkVerifyFailed', () => {
	it('counts the failure and raises a warning so failed sign-ins are visible in Sentry', () => {
		trackMagicLinkVerifyFailed('login-page')

		expect(mockCount).toHaveBeenCalledWith(
			'onboarding.magic_link.verify_failed',
			1,
			{ attributes: { source: 'login-page' } }
		)
		expect(mockCaptureMessage).toHaveBeenCalledWith(
			'onboarding.magic_link.verify_failed',
			expect.objectContaining({ level: 'warning' })
		)
	})
})

describe('trackInquirySubmitted', () => {
	it('records the picker funnel completing, noting whether the visitor was already signed in', () => {
		trackInquirySubmitted('new-session')

		expect(mockCount).toHaveBeenCalledWith('onboarding.inquiry.submitted', 1, {
			attributes: { auth: 'new-session' },
		})
		expect(mockAddBreadcrumb).toHaveBeenCalledWith({
			category: 'onboarding',
			type: 'info',
			message: 'onboarding.inquiry.submitted',
			data: { auth: 'new-session' },
		})
	})
})

describe('trackListingSubmitted', () => {
	it('records the grower funnel completing, noting whether the visitor was already signed in', () => {
		trackListingSubmitted('existing-session')

		expect(mockCount).toHaveBeenCalledWith('onboarding.listing.submitted', 1, {
			attributes: { auth: 'existing-session' },
		})
		expect(mockAddBreadcrumb).toHaveBeenCalledWith({
			category: 'onboarding',
			type: 'info',
			message: 'onboarding.listing.submitted',
			data: { auth: 'existing-session' },
		})
	})
})

describe('trackUserCreated', () => {
	it('counts a brand-new account — the moment a visitor becomes a member', () => {
		trackUserCreated()

		expect(mockCount).toHaveBeenCalledWith('onboarding.user.created', 1, {
			attributes: {},
		})
	})
})
