import js from '@eslint/js'
import solid from 'eslint-plugin-solid'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

export default [
	js.configs.recommended,
	{
		files: ['**/*.{js,mjs,cjs,ts,tsx}'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
			solid,
		},
		rules: {
			...tseslint.configs.recommended.rules,
			...solid.configs.recommended.rules,
		},
	},
	{
		ignores: ['dist/', 'node_modules/'],
	},
]
