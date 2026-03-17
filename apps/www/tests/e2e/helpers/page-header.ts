import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Test helper for the PageHeader navigation menu.
 *
 * Uses accessible selectors throughout:
 * - Trigger: button[aria-label="Navigation menu"] (via getByRole)
 * - Menu: [role="menu"] (via getByRole, only visible when open)
 * - Items: [role="menuitem"] scoped inside the open menu
 *
 * The one exception is `isSignedIn`, which falls back to a CSS class
 * because the avatar-initials element is aria-hidden="true" and has no
 * accessible role.
 */
export function pageHeader(page: Page) {
	const trigger = page.getByRole('button', { name: 'Navigation menu' })

	return {
		trigger,

		/**
		 * Returns true when the signed-in avatar initials are visible.
		 * Uses a CSS class because the initials element is aria-hidden.
		 */
		async isSignedIn(): Promise<boolean> {
			return trigger.locator('.page-header__avatar-initials').isVisible()
		},

		/** Opens the navigation menu and returns a locator for it. */
		async openMenu() {
			await trigger.click()
			const menu = page.getByRole('menu')
			await expect(menu).toBeVisible()
			return menu
		},

		/** Signs out via the navigation menu. */
		async signOut() {
			const menu = await this.openMenu()
			await menu.getByRole('menuitem', { name: 'Sign Out' }).click()
		},
	}
}
