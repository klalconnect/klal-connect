import React from 'react';
import { Link } from 'react-router-dom';
import { iconFor, guessIcon } from '@/lib/categoryIcons';
import { categoryLabel } from '@/lib/categories';
export default function CategoryGrid({categories=[],limit}) {
  const shown=limit?categories.slice(0,limit):categories;
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{shown.map((c,i)=>{const I=iconFor(c.icon&&c.icon!=='MoreHorizontal'?c.icon:guessIcon(c.name));return <Link to={`/browse?category=${encodeURIComponent(c.name)}`} key={c.id||c.slug} className="group rounded-lg bg-brand-surface p-4 ring-1 ring-brand-line transition hover:-translate-y-0.5 hover:shadow-md"><I className="mb-3 text-brand-teal" size={24}/><span className="text-sm font-semibold leading-tight">{categoryLabel(c.name)}</span></Link>})}</div>;
}