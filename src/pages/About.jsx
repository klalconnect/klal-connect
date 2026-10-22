import React from 'react';
import { Link } from 'react-router-dom';

const link = 'font-semibold text-brand-teal hover:underline';

export default function About() {
  return <div className="page-shell max-w-3xl py-10">
    <span className="eyebrow">KLAL CONNECT</span>
    <h1 className="title text-3xl">About Klal Connect</h1>
    <p className="helper">A community directory and network for the frum community.</p>

    <div className="prose-klal mt-8 space-y-8 text-brand-body">
      <section>
        <h2 className="section-title">What it is</h2>
        <p className="mt-2">Klal Connect is one place to find the businesses, professionals, shuls and gemachs the community relies on, and to connect with the people behind them. Search by what you need and where you are, see what's near you, and keep up with the community feed.</p>
      </section>

      <section>
        <h2 className="section-title">Where the listings come from</h2>
        <p className="mt-2">Most listings were compiled from public information to get the directory started, and some were added by members. They can be out of date, so check details, including kashrus, with the business directly. A listing marked "Verified by Klal" has been reviewed by our team.</p>
      </section>

      <section>
        <h2 className="section-title">Own a business that's listed?</h2>
        <p className="mt-2">Claim your listing from its page to keep it up to date, or <Link className={link} to="/contact">contact us</Link> to have it corrected or removed. Not listed yet? <Link className={link} to="/add">Add your business</Link>.</p>
      </section>

      <section>
        <h2 className="section-title">More</h2>
        <p className="mt-2">Read our <Link className={link} to="/terms">terms of use</Link> and <Link className={link} to="/privacy">privacy policy</Link>.</p>
      </section>
    </div>

    <p className="mt-10 text-sm text-brand-muted"><Link to="/" className={link}>Back to Klal Connect</Link></p>
  </div>;
}
