import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, LogOut } from 'lucide-react';
import { api } from '@/api/client';
import GuestPrompt from '@/components/GuestPrompt';
import LocationPicker from '@/components/LocationPicker';
import ChangePassword from '@/components/ChangePassword';
import NotificationSettings from '@/components/NotificationSettings';
import TranslationSettings from '@/components/TranslationSettings';
import ManageListings from '@/components/ManageListings';
import ManageCompanies from '@/components/ManageCompanies';

// Everything about the account that is not the profile itself.
export default function Settings() {
  const [user, setUser] = useState();
  useEffect(() => { (async () => {
    if (!(await api.auth.isAuthenticated())) return api.auth.redirectToLogin(location.href);
    setUser(await api.auth.me());
  })(); }, []);
  // Deep links like /settings#location land on the right panel.
  useEffect(() => {
    if (!user || !window.location.hash) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [user]);

  if (!user) return <div className="loading">Loading settings…</div>;
  if (user.guest) return <GuestPrompt title="Settings need an account" body="You're browsing as a guest. Create a free account to set your Shabbos location, notifications, password, and manage your listings."/>;

  return <div className="page-shell max-w-2xl py-9">
    <Link to="/profile" className="mb-5 flex items-center gap-2 text-sm font-semibold text-brand-teal"><ArrowLeft size={17}/>Back to your profile</Link>
    <span className="eyebrow">YOUR ACCOUNT</span>
    <h1 className="title text-3xl">Settings</h1>
    <p className="helper mb-4">Shabbos and Yom Tov times, notifications, translation, your password, and the listings and company pages you manage. Signed in as {user.email}.</p>

    <div id="location" className="scroll-mt-24"><LocationPicker user={user}/></div>
    <div id="password" className="scroll-mt-24"><ChangePassword/></div>
    <div id="notifications" className="scroll-mt-24"><NotificationSettings user={user}/></div>
    <div id="translation" className="scroll-mt-24"><TranslationSettings user={user}/></div>
    <div id="listings" className="scroll-mt-24"><ManageListings user={user}/></div>
    <div id="companies" className="scroll-mt-24"><ManageCompanies user={user}/></div>

    <div className="mt-8 flex items-center gap-3">
      <button type="button" onClick={() => api.auth.logout('/')} className="secondary"><LogOut size={16}/>Log out</button>
    </div>
  </div>;
}
