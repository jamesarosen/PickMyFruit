import { Link } from '@tanstack/solid-router'
import './PageFooter.css'
import { SupportEmail } from './SupportEmail'

export function PageFooter() {
	return (
		<footer class="page-footer">
			<div class="container">
				<div class="footer-left">
					<span class="footer-avatar">JAR</span>
					<span>
						Built by <a href="https://jamesarosen.com">James A Rosen</a>
					</span>
					<span class="footer-separator">|</span>
					<span>
						Email <SupportEmail class="text-accent" />
					</span>
				</div>
				<nav class="footer-nav">
					<Link to="/about">About</Link>
					<Link to="/privacy">Privacy</Link>
					<Link to="/terms">Terms</Link>
				</nav>
			</div>
		</footer>
	)
}
