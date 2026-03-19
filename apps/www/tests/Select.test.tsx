import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@solidjs/testing-library'

import { Select, SelectItem, SelectItemLabel } from '../src/components/Select'

describe('Select', () => {
	afterEach(cleanup)

	describe('required with initial value', () => {
		it('single: hidden input has initial value so required validation passes', () => {
			const { container } = render(() => (
				<form>
					<Select
						name="color"
						value="red"
						required
						options={['red', 'green', 'blue']}
						label="Color"
						itemComponent={(props) => (
							<SelectItem item={props.item}>
								<SelectItemLabel>{props.item.rawValue}</SelectItemLabel>
							</SelectItem>
						)}
					/>
				</form>
			))
			const form = container.querySelector('form')!
			const input = form.querySelector('input') as HTMLInputElement
			// The hidden <input required> must have its value set so constraint
			// validation knows the field is filled.
			expect(input.value).toBe('red')
		})

		it('multiple: hidden input has initial value so required validation passes', () => {
			const { container } = render(() => (
				<form>
					<Select
						name="colors"
						multiple
						value={['red', 'blue']}
						required
						options={['red', 'green', 'blue']}
						label="Colors"
						itemComponent={(props) => (
							<SelectItem item={props.item}>
								<SelectItemLabel>{props.item.rawValue}</SelectItemLabel>
							</SelectItem>
						)}
					/>
				</form>
			))
			const form = container.querySelector('form')!
			const input = form.querySelector('input') as HTMLInputElement
			// The hidden <input required> must be non-empty so required validation
			// passes. For multiple selects the first selected value is sufficient.
			expect(input.value).not.toBe('')
		})
	})

	describe('initial value in FormData', () => {
		it('single: includes initial string value in FormData', () => {
			const { container } = render(() => (
				<form>
					<Select
						name="color"
						value="red"
						options={['red', 'green', 'blue']}
						label="Color"
						itemComponent={(props) => (
							<SelectItem item={props.item}>
								<SelectItemLabel>{props.item.rawValue}</SelectItemLabel>
							</SelectItem>
						)}
					/>
				</form>
			))
			const form = container.querySelector('form')!
			expect(new FormData(form).get('color')).toBe('red')
		})

		it('multiple: includes all initial string values in FormData', () => {
			const { container } = render(() => (
				<form>
					<Select
						name="colors"
						multiple
						value={['red', 'blue']}
						options={['red', 'green', 'blue']}
						label="Colors"
						itemComponent={(props) => (
							<SelectItem item={props.item}>
								<SelectItemLabel>{props.item.rawValue}</SelectItemLabel>
							</SelectItem>
						)}
					/>
				</form>
			))
			const form = container.querySelector('form')!
			expect(new FormData(form).getAll('colors')).toEqual(['red', 'blue'])
		})

		it('single: includes initial object value (via optionValue key) in FormData', () => {
			const options = [
				{ id: 'apple', name: 'Apple' },
				{ id: 'banana', name: 'Banana' },
				{ id: 'cherry', name: 'Cherry' },
			]
			const { container } = render(() => (
				<form>
					<Select
						name="fruit"
						value={options[1]}
						options={options}
						optionValue="id"
						optionTextValue="name"
						label="Fruit"
						itemComponent={(props) => (
							<SelectItem item={props.item}>
								<SelectItemLabel>{props.item.rawValue.name}</SelectItemLabel>
							</SelectItem>
						)}
					/>
				</form>
			))
			const form = container.querySelector('form')!
			expect(new FormData(form).get('fruit')).toBe('banana')
		})

		it('multiple: includes all initial object values (via optionValue key) in FormData', () => {
			const options = [
				{ id: 'apple', name: 'Apple' },
				{ id: 'banana', name: 'Banana' },
				{ id: 'cherry', name: 'Cherry' },
			]
			const { container } = render(() => (
				<form>
					<Select
						name="fruits"
						multiple
						value={[options[0], options[2]]}
						options={options}
						optionValue="id"
						optionTextValue="name"
						label="Fruits"
						itemComponent={(props) => (
							<SelectItem item={props.item}>
								<SelectItemLabel>{props.item.rawValue.name}</SelectItemLabel>
							</SelectItem>
						)}
					/>
				</form>
			))
			const form = container.querySelector('form')!
			expect(new FormData(form).getAll('fruits')).toEqual(['apple', 'cherry'])
		})
	})
})
