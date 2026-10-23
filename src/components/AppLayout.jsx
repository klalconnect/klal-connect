import React, { Suspense } from 'react';
import { Outlet, NavLink, Link, useLocation } from 'react-router-dom';
import { Home as HomeIcon, Bookmark, UserRound, ShieldCheck, Newspaper, LayoutGrid, Users, LogOut, Settings, MessageSquare } from 'lucide-react';
import Brand from '@/components/Brand';
import ThemeToggle from '@/components/ThemeToggle';
import NotificationBell from '@/components/NotificationBell';
import ShabbosMode from '@/components/ShabbosMode';
import TravelWarningBanner from '@/components/TravelWarningBanner';
import { useDetectLocation } from '@/hooks/useDetectLocation';
import AccountRequiredModal from '@/components/AccountRequiredModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import BackToTop from '@/components/BackToTop';
import SiteFooter from '@/components/SiteFooter';
import { accountLinks } from '@/components/GuestPrompt';
import { useAuth } from '@/lib/AuthContext';
import { tabFor } from '@/lib/navTab';

const Home = HomeIcon;
// Jobs is deliberately absent until real jobs exist: a nav item that always
// leads to an empty room costs more trust than the feature earns. It is still
// reachable at /jobs, and belongs back here once there is something in it.
const links = [['Home','/',Home],['Feed','/feed',Newspaper],['Resources','/directory',LayoutGrid],['People','/people',Users],['Saved','/saved',Bookmark],['Profile','/profile',UserRound]];
// The phone bar is not the desktop nav with smaller text: eight 47px targets
// with 10px labels is a worse way to reach six places than six bigger ones.
// Saved stays in the desktop nav and on the profile page rather than competing
// for a thumb.
//
// The sixth slot is Messages, where the notifications sheet used to be — and
// the count is unchanged, because that sheet was itself the sixth target.
// Messaging is somewhere you return to and reply from, which earns a thumb;
// notifications are a glance, so they moved to the header beside settings with
// the rest of the account controls.
const mobileLinks = [...links.filter(([name]) => name !== 'Saved'), ['Messages', '/messages', MessageSquare]];
function HeaderAccount() {
  const { user, isGuest, authChecked, logout } = useAuth();
  if (!authChecked) return null;
  if (!user || isGuest) {
    const links = accountLinks(window.location.pathname + window.location.search);
    return <>
      <NavLink to={links.login} className="ml-2 hidden rounded-full px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-surface md:inline-flex">Log in</NavLink>
      {/* text-brand-canvas, not text-white. Teal is dark in light mode and
          light in dark mode, so white text on it measured 5.1 in one theme and
          2.79 in the other — failing WCAG AA on the most important button in
          the app. Canvas is the page's own background colour, which is the
          inverse of teal in each theme, so it reads 5.1 light and 7.05 dark
          with one class and no variant. */}
      <NavLink to={links.register} className="rounded-full bg-brand-teal px-3 py-1.5 text-sm font-semibold text-brand-canvas hover:opacity-90 md:px-4 md:py-2">Sign up</NavLink>
    </>;
  }
  return <>
    <button type="button" onClick={() => logout()} className="ml-1 hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-brand-muted hover:bg-brand-surface hover:text-brand-ink md:inline-flex" aria-label="Log out"><LogOut size={16}/><span className="hidden lg:inline">Log out</span></button>
  </>;
}

// Staff get into the review queues from here, on any screen. This used to
// live inside the desktop-only nav, which left an admin on a phone with no
// way into /admin at all.
function StaffLink() {
  const { user, authChecked } = useAuth();
  if (!authChecked || !user) return null;
  if (user.role !== 'admin' && user.role !== 'moderator') return null;
  return <NavLink to="/admin" className={({ isActive }) => `p-2 hover:text-brand-teal ${isActive ? 'text-brand-teal' : 'text-brand-muted'}`} aria-label="Admin" title="Admin"><ShieldCheck size={19}/></NavLink>;
}

// Notifications, on every screen size, beside the settings gear. They used to
// be a tab in the phone's bottom bar; that slot went to Messages, and a glance
// at what happened belongs with the account controls rather than competing for
// a thumb. Hidden for guests, who have no notifications of their own.
function HeaderBell() {
  const { user, isGuest, authChecked } = useAuth();
  if (!authChecked || !user || isGuest) return null;
  return <NotificationBell/>;
}

// The settings gear sits outside the desktop-only nav: on a phone the bottom
// bar has no room for it, and this is the one place it is always reachable.
function SettingsGear() {
  const { user, isGuest, authChecked } = useAuth();
  if (!authChecked || !user || isGuest) return null;
  return <NavLink to="/settings" className={({ isActive }) => `p-2 hover:text-brand-teal ${isActive ? 'text-brand-teal' : 'text-brand-muted'}`} aria-label="Settings" title="Settings"><Settings size={19}/></NavLink>;
}

export default function AppLayout() {
  useDetectLocation();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const tab = tabFor(pathname, user?.id);
  // pb clears the phone's bottom bar, which is taller than 5rem once the home
  // indicator's inset is added — content was sitting behind it on a notched
  // iPhone.
  return <div className="min-h-screen bg-brand-canvas text-brand-ink pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
    <AccountRequiredModal/>
    {/* The header carries the status-bar inset itself, so these two banners sit
        below it rather than above: installed to the home screen, anything at the
        very top of the document is behind the Dynamic Island. */}
    <header className="sticky top-0 z-40 border-b border-brand-line bg-brand-canvas/95 pt-[env(safe-area-inset-top)] backdrop-blur"><div className="mx-auto flex h-16 max-w-7xl items-center justify-between pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"><Brand/><div className="flex items-center gap-1"><nav className="hidden items-center gap-1 md:flex">{links.map(([n,p])=><Link key={n} to={p} aria-current={tab===n?'page':undefined} className={`rounded-full px-4 py-2 text-sm ${tab===n?'bg-brand-teal/15 font-semibold text-brand-teal ring-1 ring-brand-teal/40':'font-medium text-brand-ink hover:bg-brand-surface'}`}>{n}</Link>)}</nav><HeaderAccount/><StaffLink/><HeaderBell/><SettingsGear/><ThemeToggle/></div></div></header>
    <ShabbosMode/>
    <TravelWarningBanner/>
    {/* A page that throws should not take the header and the tab bar with it:
        the person needs a way to get somewhere else. The outer boundary in
        App.jsx still catches anything that breaks the layout itself. */}
    {/* Suspense sits here, not around the router: a lazy route (admin, jobs)
        loading on a slow connection should swap the page, not unmount the
        header and the bottom nav down to a bare "Loading…". */}
    <main><ErrorBoundary><Suspense fallback={<div className="loading">Loading…</div>}><Outlet/></Suspense></ErrorBoundary></main>
    <SiteFooter className="mt-10"/>
    <BackToTop/>
    {/* repeat(6,minmax(0,1fr)), not grid-cols-6: `1fr` is minmax(auto,1fr), so
        each column refused to go narrower than its own label — "Resources"
        wants about 58px, six of those is 348px, and the bar ran off a 320px
        screen. The labels truncate instead of setting the width. */}
    <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-[repeat(6,minmax(0,1fr))] border-t border-brand-line bg-brand-surface pl-[max(.5rem,env(safe-area-inset-left))] pr-[max(.5rem,env(safe-area-inset-right))] pb-[max(.4rem,env(safe-area-inset-bottom))] pt-2 md:hidden">{mobileLinks.map(([n,p,I])=><Link key={n} to={p} aria-current={tab===n?'page':undefined} className={`relative flex min-w-0 flex-col items-center gap-0.5 text-[11px] ${tab===n?'font-bold text-brand-teal':'text-brand-muted'}`}>{tab===n&&<span aria-hidden="true" className="absolute -top-2 h-[3px] w-8 rounded-full bg-brand-teal"/>}<span className={`grid h-7 w-12 place-items-center rounded-full ${tab===n?'bg-brand-teal/15':''}`}><I size={20} className="shrink-0"/></span><span className="max-w-full truncate">{n}</span></Link>)}</nav>
  </div>;
}