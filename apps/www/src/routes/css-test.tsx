import { createFileRoute } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import '@/routes/css-test.css'

export const Route = createFileRoute('/css-test')({
	component: CssTestPage,
})

function CssTestPage() {
	let dialogRef: HTMLDialogElement | undefined

	const openDialog = () => {
		dialogRef?.showModal()
	}

	const closeDialog = () => {
		dialogRef?.close()
	}

	return (
		<Layout title="CSS Demo">
			<main>
				<h1>Pick My Fruit CSS Test Document</h1>

				<p>
					This document exists to test the Pick My Fruit CSS. Eventually, this
					should move to Storybook or similar.
				</p>

				<section>
					<h2>Typography & Text Wrapping</h2>
					<h3>
						This is a really long heading that should demonstrate the{' '}
						<code>text-wrap: balance</code> feature when it spans multiple lines
					</h3>
					<p>
						Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
						eiusmod tempor incididunt ut labore et dolore magna aliqua. This
						paragraph should demonstrate the <code>text-wrap: pretty</code>{' '}
						feature for better readability with supercalifragilisticexpialidocious
						words.
					</p>
					<p>
						<em>
							Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris
							nisi ut aliquip ex ea commodo consequat.
						</em>
					</p>

					<h4>Heading Level 4</h4>
					<h5>Heading Level 5</h5>
					<h6>Heading Level 6</h6>
				</section>

				<section>
					<h2>Lists</h2>
					<ul role="list">
						<li>Apples from backyard trees</li>
						<li>Pears waiting to be picked</li>
						<li>Plums overflowing from branches</li>
						<li>Figs ripening in the sun</li>
					</ul>

					<ol role="list">
						<li>Register as a tree owner</li>
						<li>Mark your fruit availability</li>
						<li>Connect with local gleaners</li>
						<li>Share the harvest</li>
					</ol>
				</section>

				<section>
					<h2>Forms & Inputs</h2>
					<form>
						<fieldset>
							<legend>Tree Registration Form</legend>
							<p>
								<label for="tree-type">Tree Type:</label>
								<br />
								<select id="tree-type">
									<option>Apple</option>
									<option>Pear</option>
									<option>Plum</option>
									<option>Fig</option>
								</select>
							</p>
							<p>
								<label for="location">Location:</label>
								<br />
								<input
									type="text"
									id="location"
									placeholder="Enter your address"
								/>
							</p>
							<p>
								<label for="notes">Additional Notes:</label>
								<br />
								<textarea id="notes" rows="4" cols="50">
									This textarea should resize vertically only and inherit the
									page font.
								</textarea>
							</p>
							<p>
								<button type="submit">Submit Registration</button>
								<button type="reset">Clear Form</button>
							</p>
						</fieldset>
					</form>
				</section>

				<section>
					<h2>Images & Media</h2>
					<img
						src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='400'%3E%3Crect fill='%234a7c2c' width='800' height='400'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='24' fill='white' text-anchor='middle' dy='.3em'%3EResponsive Fruit Tree Image%3C/text%3E%3C/svg%3E"
						alt="Placeholder fruit tree"
					/>
					<p>This image should be responsive and not overflow its container.</p>
				</section>

				<section>
					<h2>Tables</h2>
					<table>
						<thead>
							<tr>
								<th>Tree Owner</th>
								<th>Fruit Type</th>
								<th>Harvest Date</th>
								<th>Pounds Rescued</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>Jane Smith</td>
								<td>Apple</td>
								<td>Sept 15, 2025</td>
								<td>127 lbs</td>
							</tr>
							<tr>
								<td>Bob Johnson</td>
								<td>Pear</td>
								<td>Oct 1, 2025</td>
								<td>89 lbs</td>
							</tr>
							<tr>
								<td>Maria Garcia</td>
								<td>Plum</td>
								<td>Aug 22, 2025</td>
								<td>203 lbs</td>
							</tr>
						</tbody>
					</table>
				</section>

				<section>
					<h2>Links & Focus States</h2>
					<p>
						Visit our <a href="#">volunteer opportunities</a> page to learn more.
						Try tabbing through this page to see <a href="#">focus states</a> in
						action.
					</p>
					<p>
						You can also <a href="#">learn about our mission</a> or{' '}
						<a href="#">contact us</a> directly.
					</p>
				</section>

				<section>
					<h2>Code & Preformatted Text</h2>
					<p>
						To register a tree, use the <code>registerTree()</code> function:
					</p>
					<pre>
						<code>{`
const tree = {
	type: 'apple',
	location: 'Napa, CA',
	harvestDate: '2025-09-15'
};

registerTree(tree);`}</code>
					</pre>
					<p>
						Use <kbd>Ctrl+S</kbd> to save your changes.
					</p>
				</section>

				<section>
					<h2>Quotes & Abbreviations</h2>
					<blockquote>
						"Blessed are those who plant trees under which they will never sit."
						This blockquote should have standard quote marks.
					</blockquote>
					<p>
						Someone once said{' '}
						<q>
							food waste exists alongside hunger because of broken connections
						</q>{' '}
						and they were absolutely right.
					</p>
					<p>
						Join <abbr title="Pick My Fruit">PMF</abbr> today and become part of
						the solution.
					</p>
				</section>

				<section>
					<h2>Box Model</h2>
					<div style={{ border: '2px solid #4a7c2c', padding: '1rem', width: '100%' }}>
						This div has width: 100%, padding, and a border. With box-sizing:
						border-box, it should not overflow its container.
					</div>
				</section>

				<section>
					<h2>
						Hidden Element (<code>[hidden]</code>)
					</h2>
					<p>
						There's a hidden paragraph below this one (inspect the DOM to see it):
					</p>
					<p hidden>This should not be visible at all, ever.</p>
					<p>And here's the paragraph after the hidden one.</p>
				</section>

				<dialog ref={dialogRef}>
					<h3>Dialog Example</h3>
					<p>This dialog has a backdrop.</p>
					<button onClick={closeDialog}>Close</button>
				</dialog>

				<button onClick={openDialog}>Open Dialog (Test backdrop)</button>

				<section>
					This section uses the default theme. The{' '}
					<code class="text-primary">.text-primary</code>,{' '}
					<code class="text-secondary">.text-secondary</code>, and{' '}
					<code class="text-accent">.text-accent</code> utility classes change text
					color. It also supports dark mode.
				</section>
			</main>
		</Layout>
	)
}
