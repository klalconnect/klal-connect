import React, { useState } from 'react';
import { MapPin, LocateFixed } from 'lucide-react';

// Shown where a "Near you" section would be when we do not know where the
// person is. Nothing is guessed: the far-away "most used" lists this replaces
// were exactly the problem. The browser asks permission when the button is
// pressed, never on its own.
export default function NearYouPrompt({ ask, title = 'See what is near you', children }) {
  const [state, setState] = useState('');
  const locate = async () => {
    setState('asking');
    setState((await ask()) ? '' : 'denied');
  };
  return <section className="rounded-xl bg-brand-surface p-5 ring-1 ring-brand-line">
    <span className="eyebrow">NEAR YOU</span>
    <h2 className="mt-1 font-heading text-xl font-bold text-brand-ink">{title}</h2>
    <p className="mt-1 text-sm text-brand-body">Share your location to see listings close to you. It stays in this browser.{children ? ' ' : ''}{children}</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" onClick={locate} disabled={state === 'asking'} className="primary disabled:opacity-60"><LocateFixed size={16} />{state === 'asking' ? 'Finding you…' : 'Use my location'}</button>
      {state === 'denied' && <span className="inline-flex items-center gap-1.5 text-sm text-brand-muted"><MapPin size={14} />Location is off for this site. You can search a city above instead.</span>}
    </div>
  </section>;
}
