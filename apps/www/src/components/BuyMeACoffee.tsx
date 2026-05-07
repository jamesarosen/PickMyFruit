import { onCleanup, onMount } from 'solid-js'
import './BuyMeACoffee.css'

/** Floating Buy Me a Coffee donation widget. Loads the third-party script on mount. */
export function BuyMeACoffee() {
	onMount(() => {
		const script = document.createElement('script')
		script.type = 'text/javascript'
		script.src = 'https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js'
		script.setAttribute('data-name', 'bmc-button')
		script.setAttribute('data-slug', 'jamesarosen')
		script.setAttribute('data-color', '#f3eacd')
		script.setAttribute('data-emoji', '🌱')
		script.setAttribute('data-font', 'Bree')
		script.setAttribute('data-text', 'Support Us')
		script.setAttribute('data-outline-color', '#000000')
		script.setAttribute('data-font-color', '#000000')
		script.setAttribute('data-coffee-color', '#FFDD00')
		document.head.appendChild(script)

		onCleanup(() => {
			script.remove()
			// The BMC script appends its button to <body>; remove it on cleanup.
			document.getElementById('bmc-wbtn')?.remove()
		})
	})

	return null
}
