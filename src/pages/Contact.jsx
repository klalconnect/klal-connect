import React from 'react';
import { Link } from 'react-router-dom';

const link = 'font-semibold text-brand-teal hover:underline';

export default function Contact() {
  return <div className="page-shell max-w-3xl py-10">
    <span className="eyebrow">KLAL CONNECT</span>
    <h1 className="title text-3xl">Contact us</h1>
    <p className="helper">Questions, ideas, corrections or removal requests: we read every message.</p>

    <div className="prose-klal mt-8 space-y-8 text-brand-body">
      <section>
        <h2 className="section-title">Email</h2>
        <p className="mt-2"><a className={link} href="mailto:hello@klalconnect.org">hello@klalconnect.org</a></p>
      </section>

      <section>
        <h2 className="section-title">About a listing</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Something's wrong:</b> use Suggest a Correction on the listing's page.</li>
          <li><b>A concern you'd rather keep private:</b> use Report an issue on the listing's page. Reports go only to our review team.</li>
          <li><b>It's your business:</b> claim it from the listing's page so you can keep it up to date.</li>
          <li><b>You want it taken down:</b> email us with the link and we'll remove it.</li>
        </ul>
      </section>
    </div>

    <p className="mt-10 text-sm text-brand-muted"><Link to="/" className={link}>Back to Klal Connect</Link></p>
  </div>;
}
