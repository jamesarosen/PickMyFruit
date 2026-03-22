import { createSignal, Show } from 'solid-js'
import { Link, useLocation, useRouteContext } from '@tanstack/solid-router'
import { displayName } from '@/lib/display-name'
import './NamePromptBanner.css'

const DISMISS_KEY = 'namePromptBannerDismissed'

/**
 * Non-blocking banner prompting users with no real name to set one.
 * Dismiss state is stored in sessionStorage — reappears on next login.
 * Delete this file and its import in Layout.tsx when most users have a real name.
 */
export default function NamePromptBanner() {
	const location = useLocation()
	const isProfile = () => location().pathname === '/profile'
	const context = useRouteContext({ from: '__root__' })
	const user = () => context().session?.user
	const hasRealName = () => (user()?.name?.trim() ?? '').length > 0
	const [dismissed, setDismissed] = createSignal(
		typeof sessionStorage !== 'undefined' &&
			sessionStorage.getItem(DISMISS_KEY) === '1'
	)

	function dismiss() {
		try {
			sessionStorage.setItem(DISMISS_KEY, '1')
		} catch {
			// sessionStorage unavailable — dismiss in-memory only
		}
		setDismissed(true)
	}

	return (
		<Show when={!isProfile() && user() && !hasRealName() && !dismissed()}>
			<div class="name-prompt-banner surface-contrast" role="status">
				<p>
					You're showing up as <strong>'{displayName(user()!)}'</strong> to listing
					owners. <Link to="/profile">Add your name →</Link>
				</p>
				<button
					type="button"
					class="name-prompt-banner__dismiss"
					aria-label="Dismiss"
					onClick={dismiss}
				>
					×
				</button>
			</div>
		</Show>
	)
}
