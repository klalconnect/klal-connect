import React from 'react';
import { Link } from 'react-router-dom';

const FOOTER_LINKS = [['Terms', '/terms'], ['Privacy', '/privacy'], ['Contact', '/contact'], ['About', '/about']];

// On every screen, signed in or not: the app pages through AppLayout and the
// sign-in screens through AuthLayout. Quiet on purpose; it is there to be
// found, not to compete with the page above it.
export default function SiteFooter({ className = '' }) {
  return <footer className={`border-t border-brand-line py-6 text-sm text-brand-muted ${className}`}>
    <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-5 gap-y-2 px-4 md:justify-between">
      <nav aria-label="Site" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
        {FOOTER_LINKS.map(([label, to]) => <Link key={to} to={to} className="hover:text-brand-teal hover:underline">{label}</Link>)}
      </nav>
      <p>© {new Date().getFullYear()} Klal Connect</p>
    </div>
  </footer>;
}
