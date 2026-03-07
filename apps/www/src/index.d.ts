import type {
	CustomElements,
	CustomCssProperties,
} from '@awesome.me/webawesome/dist/custom-elements-jsx.d.ts'

/**
 * Add Web Awesome Custom Elements and CSS to SolidJS's JSX namespace.
 * @see https://webawesome.com/docs/
 */
declare module 'solid-js' {
	namespace JSX {
		interface IntrinsicElements extends CustomElements {}
	}
	interface CSSProperties extends CustomCssProperties {}
}
