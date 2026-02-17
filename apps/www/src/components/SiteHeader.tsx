import { Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import { useSession, signOut } from '@/lib/auth-client'
import './SiteHeader.css'

export type Breadcrumb = { label: string; to?: string }

/** Shared page header with breadcrumbs and auth navigation. */
export default function SiteHeader(props: { breadcrumbs?: Breadcrumb[] }) {
	const session = useSession()

	return (
		<header class="site-header">
			<nav class="breadcrumb" aria-label="Breadcrumb">
				<ol>
					<li>
						<Link to="/">Home</Link>
					</li>
					<For each={props.breadcrumbs}>
						{(crumb) => (
							<li>
								<Show
									when={crumb.to}
									fallback={<span aria-current="page">{crumb.label}</span>}
								>
									{(to) => <Link to={to()}>{crumb.label}</Link>}
								</Show>
							</li>
						)}
					</For>
				</ol>
			</nav>
			<nav class="header-nav" aria-label="Account">
				<Show
					when={session().data?.user}
					fallback={
						<Link to="/login" class="nav-link">
							Sign In
						</Link>
					}
				>
					<Link to="/listings/mine" class="nav-link">
						My Garden
					</Link>
					<button type="button" class="nav-link sign-out" onClick={() => signOut()}>
						Sign Out
					</button>
				</Show>
			</nav>
		</header>
	)
}
