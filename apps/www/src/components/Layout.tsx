import type { JSX } from 'solid-js'

export interface LayoutProps {
	title: string
	children: JSX.Element
}

export default function Layout(props: LayoutProps) {
	// Update document title when component mounts or title changes
	document.title = props.title

	return <>{props.children}</>
}
