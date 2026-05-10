import './BuyMeACoffee.css'

/** Floating Buy Me a Coffee donation widget. Loads the third-party script on mount. */
export function BuyMeACoffee() {
	return (
		<script
			type="text/javascript"
			src="https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js"
			data-name="bmc-button"
			data-slug="jamesarosen"
			data-color="#f3eacd"
			data-emoji="🐝"
			data-font="Bree"
			data-text="Support our Garden"
			data-outline-color="#000000"
			data-font-color="#000000"
			data-coffee-color="#FFDD00"
		/>
	)
}
