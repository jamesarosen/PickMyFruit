import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, fireEvent } from '@solidjs/testing-library'
import { splitProps } from 'solid-js'

const mockNavigate = vi.fn()
const mockSession = vi.fn(() => ({ session: undefined }))
vi.mock('@tanstack/solid-router', () => ({
	// Render Link as a plain <a> while forwarding every other prop. Kobalte's
	// DropdownMenu.Item uses Polymorphic to inject id, role="menuitem", refs,
	// and event handlers onto whatever element is supplied via `as` — dropping
	// those props would short-circuit the behavior under test.
	Link: (props: any) => {
		const [local, rest] = splitProps(props, [
			'to',
			'replace',
			'preload',
			'preloadDelay',
			'activeProps',
			'inactiveProps',
			'resetScroll',
			'hashScrollIntoView',
			'startTransition',
			'viewTransition',
			'ignoreBlocker',
		])
		const handleClick = (event: MouseEvent) => {
			if (
				event.button === 0 &&
				!event.defaultPrevented &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.shiftKey &&
				!event.altKey
			) {
				event.preventDefault()
				mockNavigate({ to: local.to })
			}
		}
		return <a {...rest} href={local.to} onClick={handleClick} />
	},
	useNavigate: () => mockNavigate,
	useRouter: () => ({ invalidate: vi.fn() }),
	useRouteContext: () => mockSession,
	useLocation: () => () => ({ pathname: '/', search: '', hash: '' }),
}))

vi.mock('@/lib/auth-client', () => ({
	authClient: { signOut: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('../src/components/NamePromptBanner', () => ({
	default: () => null,
}))

const { default: PageHeader } = await import('../src/components/PageHeader')

async function openMenuAndGetFirstItem(
	getByRole: (role: string, opts?: object) => HTMLElement
) {
	const trigger = getByRole('button', { name: 'Navigation menu' })
	fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
	fireEvent.click(trigger, { button: 0 })
	return waitFor(
		() => {
			const item = document.querySelector(
				'[role="menuitem"]'
			) as HTMLElement | null
			if (!item) throw new Error('menu not yet rendered')
			return item
		},
		{ timeout: 2000 }
	)
}

describe('PageHeader navigation menu', () => {
	beforeEach(() => vi.clearAllMocks())
	afterEach(cleanup)

	it('keeps the portal mounted after touch pointerup (prevents iOS click suppression)', async () => {
		// closeOnSelect={false} on DropdownMenuLink prevents Kobalte from
		// scheduling its setTimeout(0) close inside onSelect. Without that
		// timeout, iOS Safari's synthetic click lands on a still-mounted <a>
		// and navigation succeeds. This test asserts the mechanism: the element
		// must remain in the document after pointerup fires.
		const { getByRole } = render(() => <PageHeader />)
		const signIn = await openMenuAndGetFirstItem(getByRole)

		const opts = { bubbles: true, cancelable: true, button: 0 }
		signIn.dispatchEvent(
			new PointerEvent('pointerdown', { ...opts, pointerType: 'touch' })
		)
		signIn.dispatchEvent(
			new PointerEvent('pointerup', { ...opts, pointerType: 'touch' })
		)

		expect(document.contains(signIn)).toBe(true)
	})

	it('navigates when a menu item is clicked', async () => {
		const { getByRole } = render(() => <PageHeader />)
		const signIn = await openMenuAndGetFirstItem(getByRole)

		fireEvent.click(signIn, { button: 0 })

		expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' })
	})

	it('does not intercept modifier-clicks (browser handles cmd/ctrl/shift natively)', async () => {
		const { getByRole } = render(() => <PageHeader />)
		const signIn = await openMenuAndGetFirstItem(getByRole)

		const event = new MouseEvent('click', {
			bubbles: true,
			cancelable: true,
			button: 0,
			metaKey: true,
		})
		signIn.dispatchEvent(event)

		expect(mockNavigate).not.toHaveBeenCalled()
	})
})
