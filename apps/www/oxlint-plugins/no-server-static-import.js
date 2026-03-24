/**
 * Oxlint plugin that disallows static imports of `*.server` modules.
 * Dynamic `import()` calls are allowed — they're the correct way to
 * load server-only code from a shared/client context.
 *
 * @example
 * // BAD — static import leaks server code into the client bundle
 * import { db } from "@/data/db.server";
 *
 * // GOOD — dynamic import is tree-shaken / lazy
 * const { db } = await import("@/data/db.server");
 */

/** @param {string} source */
function isServerModule(source) {
	return /\.server(\.[a-z]+)?$/.test(source)
}

/** @param {string} filename */
function isServerFile(filename) {
	// Files named *.server.ts, *.server.tsx, *.server.test.ts, etc. may freely
	// import other server modules — they are themselves server-only code.
	return /\.server\./.test(filename)
}

const rule = {
	create(context) {
		return {
			ImportDeclaration(node) {
				if (!isServerModule(node.source.value)) return
				if (node.importKind === 'type') return
				const filename = context.getFilename?.() ?? context.filename ?? ''
				if (isServerFile(filename)) return
				context.report({
					node,
					message:
						'Static imports of *.server modules are not allowed. Use a dynamic import() instead.',
				})
			},
		}
	},
}

const plugin = {
	meta: { name: 'local' },
	rules: { 'no-server-static-import': rule },
}

export default plugin
