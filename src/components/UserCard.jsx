import React from 'react';
import { Link } from 'react-router-dom';
import { Image } from '@/components/ui/image';
import { MapPin, Briefcase } from 'lucide-react';
import { topJob } from '@/lib/connections';
import Headline from '@/components/Headline';
import ProfileBanner, { PHOTO_EDGE } from '@/components/ProfileBanner';
import ConnectButton from '@/components/ConnectButton';
import MessageButton from '@/components/MessageButton';
import { WorkStatusRing, WorkStatusBadge } from '@/components/WorkStatus';

export default function UserCard({ user, me, connections, onReload }) {
  const job = topJob(user);
  const initials = (user.full_name || user.email || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="overflow-hidden rounded-xl bg-brand-surface ring-1 ring-brand-line">
      {/* Shorter than the profile header's, so a card stays a card. */}
      <ProfileBanner url={user.banner_url} heightClass="h-20" />

      {/* relative z-10, or the banner paints over the avatar pulled up beneath it. */}
      <div className="relative z-10 -mt-8 space-y-3 px-5 pb-5">
        <Link to={`/profile/${user.id}`} className="block">
          <WorkStatusRing user={user} ribbon={false}>
          {user.avatar_url ? (
            <div className="h-14 w-14 overflow-hidden rounded-full" style={PHOTO_EDGE}>
              <Image src={user.avatar_url} fittingType="fill" className="h-14 w-14" />
            </div>
          ) : (
            <div className="grid h-14 w-14 place-items-center rounded-full bg-brand-tint text-lg font-bold text-brand-teal ring-4 ring-brand-surface">
              {initials}
            </div>
          )}
          </WorkStatusRing>
          <div className="mt-2 min-w-0">
            <p className="truncate font-semibold text-brand-ink">{user.full_name || 'Community member'}</p>
            <Headline text={user.headline} />
            <p className="text-sm capitalize text-brand-teal">
              {(user.profile_type || 'community_member').replace('_', ' ')}
            </p>
            <WorkStatusBadge user={user} className="mt-1.5" />
          </div>
        </Link>

        {job && (
          <p className="flex items-center gap-2 text-sm text-brand-body">
            <Briefcase size={14} className="shrink-0 text-brand-teal" />
            {job.title}{job.company ? `, ${job.company}` : ''}
          </p>
        )}
        {user.home_city && (
          <p className="flex items-center gap-2 text-sm text-brand-body">
            <MapPin size={14} className="shrink-0 text-brand-teal" />
            {user.home_city}
          </p>
        )}

        {/* Message only renders once you are connected — reaching out without a
            connection is what turns a community app into a cold-outreach one. */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ConnectButton targetId={user.id} me={me} connections={connections} onReload={onReload} size="sm" />
          <MessageButton targetId={user.id} me={me} connections={connections} size="sm" />
        </div>
      </div>
    </div>
  );
}
