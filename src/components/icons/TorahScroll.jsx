import React from 'react';

// Lucide's scroll is a sheet of paper, and shuls were sharing Financial's bank
// building. A Sefer Torah: two atzei chaim with the parchment between them.
// Drawn on lucide's 24px grid with the same props and stroke, so it sits in
// the category grid and the admin icon picker like any other icon.
export default function TorahScroll({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...rest}>
    <rect x="3" y="4" width="4" height="16" rx="2" />
    <rect x="17" y="4" width="4" height="16" rx="2" />
    <path d="M5 2v2M5 20v2M19 2v2M19 20v2" />
    <path d="M7 6h10M7 18h10" />
    <path d="M10 10h4M10 14h4" />
  </svg>;
}
