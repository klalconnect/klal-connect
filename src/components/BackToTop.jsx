import React, { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

// Only once you are a screen or so down: on a short page, or at the top of a
// long one, there is nothing to jump to and the button would just be clutter.
const SHOW_AFTER_PX = 600;

export default function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let frame = 0;
    const check = () => { frame = 0; setShow(window.scrollY > SHOW_AFTER_PX); };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(check); };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, []);

  // Instant, not smooth: from far down a feed a smooth scroll takes a second or
  // more of the page whizzing past, and the ask was to be at the top now.
  const toTop = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  // Bottom-right, above the phone's tab bar (which is taller once the home
  // indicator's inset is added), and under it in stacking order so it can
  // never cover a tab.
  return <button
    type="button"
    onClick={toTop}
    aria-label="Back to top"
    title="Back to top"
    tabIndex={show ? 0 : -1}
    aria-hidden={!show}
    className={`fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-40 flex h-11 w-11 items-center justify-center rounded-full border border-brand-line/50 bg-brand-surface/45 text-brand-ink/80 shadow-sm backdrop-blur-sm transition-opacity duration-200 hover:text-brand-teal md:bottom-6 md:right-6 ${show ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
  ><ArrowUp size={20} /></button>;
}
