import { DropdownMenu } from '@kobalte/core/dropdown-menu'
import {
	Link,
	useNavigate,
	useRouteContext,
	useRouter,
} from '@tanstack/solid-router'
import { clsx } from 'clsx'
import { For, Show, type ParentProps } from 'solid-js'
import { authClient } from '@/lib/auth-client'
import { displayName } from '@/lib/display-name'
import './PageHeader.css'
import NamePromptBanner from './NamePromptBanner'

export type Breadcrumb = {
	/** Visible text for this crumb. */
	label: string
	/**
	 * If provided, the crumb is rendered as a link.
	 * Omit only on the **last** crumb — it will receive aria-current="page".
	 */
	to?: string
}

export interface PageHeaderProps {
	/**
	 * Breadcrumb trail describing the current page's position in the hierarchy.
	 * Omit (or pass an empty array) on the home route — the breadcrumb row will
	 * not render. A "Home" crumb before this list is always rendered automatically.
	 */
	breadcrumbs?: Breadcrumb[]
}

function HamburgerIcon() {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 20 20"
			fill="none"
			aria-hidden="true"
		>
			<rect x="2" y="4" width="16" height="2" rx="1" fill="currentColor" />
			<rect x="2" y="9" width="16" height="2" rx="1" fill="currentColor" />
			<rect x="2" y="14" width="16" height="2" rx="1" fill="currentColor" />
		</svg>
	)
}

function getInitials(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => w[0].toUpperCase())
		.join('')
		.slice(0, 2)
}

/** A dropdown menu item rendered as a router link with aria-current support. */
function DropdownMenuLink(props: ParentProps<{ to: string; class?: string }>) {
	return (
		<DropdownMenu.Item
			as={Link}
			to={props.to}
			class={clsx('page-header__menu-item', props.class)}
		>
			{props.children}
		</DropdownMenu.Item>
	)
}

/** Unified page header with logo, nav menu, and optional breadcrumbs. */
export default function PageHeader(props: PageHeaderProps) {
	const router = useRouter()
	const navigate = useNavigate()
	const context = useRouteContext({ from: '__root__' })

	const hasBreadcrumbs = () => (props.breadcrumbs?.length ?? 0) > 0
	const user = () => context().session?.user

	async function handleSignOut() {
		await authClient.signOut(router)
		navigate({ to: '/', replace: true })
	}

	return (
		<>
			<header
				class="page-header"
				classList={{ 'page-header--has-breadcrumbs': hasBreadcrumbs() }}
			>
				<nav class="page-header__site-nav" aria-label="Site">
					<Link to="/" class="page-header__logo">
						<span class="page-header__logo-icon" aria-hidden="true">
							🍑
						</span>
						<span class="page-header__logo-text">Pick My Fruit</span>
					</Link>

					<DropdownMenu>
						{/* aria-label is stable; Kobalte manages aria-expanded and aria-haspopup */}
						<DropdownMenu.Trigger
							class="page-header__menu-trigger"
							aria-label="Navigation menu"
						>
							<Show when={user()} fallback={<HamburgerIcon />}>
								{(u) => (
									<Show
										when={u().image}
										fallback={
											<span class="page-header__avatar-initials" aria-hidden="true">
												{getInitials(displayName(u()))}
											</span>
										}
									>
										{(image) => (
											// Avatar is decorative: the button's aria-label already names the trigger
											<img src={image()} alt="" class="page-header__avatar-img" />
										)}
									</Show>
								)}
							</Show>
						</DropdownMenu.Trigger>

						<DropdownMenu.Portal>
							<DropdownMenu.Content class="page-header__menu-content">
								<Show when={user()}>
									<DropdownMenuLink to="/listings/mine">My Garden</DropdownMenuLink>
									<DropdownMenuLink to="/notifications">Notifications</DropdownMenuLink>
									<DropdownMenuLink to="/profile">Profile</DropdownMenuLink>
									<DropdownMenu.Separator class="page-header__menu-separator" />
									<DropdownMenu.Item
										class="page-header__menu-item page-header__menu-item--danger"
										onSelect={handleSignOut}
									>
										Sign Out
									</DropdownMenu.Item>
								</Show>
								<Show when={!user()}>
									<DropdownMenuLink to="/login">Sign In</DropdownMenuLink>
								</Show>
							</DropdownMenu.Content>
						</DropdownMenu.Portal>
					</DropdownMenu>
				</nav>

				<Show when={hasBreadcrumbs()}>
					<nav class="page-header__breadcrumb" aria-label="Breadcrumb">
						<ol>
							<li>
								<Link to="/">Home</Link>
							</li>
							<For each={props.breadcrumbs}>
								{(crumb, index) => (
									<li>
										<Show
											when={crumb.to}
											fallback={
												// aria-current only on the last crumb, regardless of whether to is absent
												<span
													aria-current={
														index() === props.breadcrumbs!.length - 1 ? 'page' : undefined
													}
												>
													{crumb.label}
												</span>
											}
										>
											{(to) => <Link to={to()}>{crumb.label}</Link>}
										</Show>
									</li>
								)}
							</For>
						</ol>
					</nav>
				</Show>
			</header>
			<NamePromptBanner />
		</>
	)
}
