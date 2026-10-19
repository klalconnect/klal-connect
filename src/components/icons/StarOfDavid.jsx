import React from 'react';

// Lucide has no Magen David, and shuls were sharing Financial's bank building.
// Drawn on lucide's 24px grid with the same props and stroke, so it sits in
// the category grid and the admin icon picker like any other icon.
export default function StarOfDavid({ size = 24, strokeWidth = 2, className = '', ...rest }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...rest}>
    <path d="M12 2.5 20.5 17h-17Z" />
    <path d="M12 21.5 3.5 7h17Z" />
  </svg>;
}
