import React from 'react';

// What a page shows while its information is still on the way, so a slow
// second never reads as "nothing here". The empty message belongs to after
// the load, when there really is nothing.

export function Spinner({ className = '' }) {
  return <span aria-hidden="true" className={`kc-spinner ${className}`} />;
}

// One quiet line: the teal spinner and what is being fetched.
export function LoadingNote({ label = 'Loading…', className = '' }) {
  return <p role="status" className={`flex items-center gap-2 text-sm font-medium text-brand-body ${className}`}>
    <Spinner />{label}
  </p>;
}

// Shimmering stand-ins shaped like the cards about to arrive, under a
// LoadingNote that says what is coming (label={null} when the page already
// says it elsewhere). `kind` picks the shape.
export function LoadingCards({ count = 4, kind = 'listing', label = 'Loading…', className = '', grid }) {
  const Card = CARDS[kind] || CARDS.listing;
  return <div className={className}>
    {label === null ? <span role="status" className="sr-only">Loading…</span> : <LoadingNote label={label} className="mb-3" />}
    <div aria-hidden="true" className={grid || GRIDS[kind] || GRIDS.listing}>
      {Array.from({ length: count }, (_, i) => <Card key={i} />)}
    </div>
  </div>;
}

const GRIDS = {
  listing: 'grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]',
  post: 'space-y-4',
  person: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3',
  tile: 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4',
  row: 'space-y-3',
};

const Bar = ({ className }) => <span className={`kc-skel block h-3 rounded-full ${className}`} />;

const CARDS = {
  listing: () => <div className="rounded-xl bg-brand-surface p-5 ring-1 ring-brand-line">
    <div className="flex gap-4">
      <span className="kc-skel h-14 w-14 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2.5 pt-1">
        <Bar className="h-4 w-3/5" />
        <Bar className="w-2/5" />
        <Bar className="w-4/5" />
      </div>
    </div>
    <div className="mt-4 flex gap-2"><Bar className="h-6 w-20" /><Bar className="h-6 w-16" /></div>
  </div>,
  post: () => <div className="rounded-xl bg-brand-surface p-5 ring-1 ring-brand-line">
    <div className="flex items-center gap-3">
      <span className="kc-skel h-11 w-11 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2"><Bar className="h-4 w-2/5" /><Bar className="w-1/4" /></div>
    </div>
    <div className="mt-4 space-y-2.5"><Bar className="w-full" /><Bar className="w-11/12" /><Bar className="w-3/5" /></div>
  </div>,
  person: () => <div className="rounded-xl bg-brand-surface p-5 ring-1 ring-brand-line">
    <div className="flex items-center gap-3">
      <span className="kc-skel h-14 w-14 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2"><Bar className="h-4 w-3/5" /><Bar className="w-4/5" /></div>
    </div>
    <Bar className="mt-4 h-8 w-full rounded-xl" />
  </div>,
  tile: () => <div className="rounded-lg bg-brand-surface p-4 ring-1 ring-brand-line">
    <span className="kc-skel mb-3 block h-6 w-6 rounded-md" />
    <Bar className="w-3/4" />
  </div>,
  row: () => <div className="flex items-center gap-3 rounded-xl bg-brand-surface p-4 ring-1 ring-brand-line">
    <span className="kc-skel h-10 w-10 shrink-0 rounded-full" />
    <div className="min-w-0 flex-1 space-y-2"><Bar className="w-2/5" /><Bar className="w-3/5" /></div>
  </div>,
};
