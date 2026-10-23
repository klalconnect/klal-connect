import { api } from "@/api/client";

export const NOTIFICATION_TYPES = [
  { key: 'like', label: 'Likes on your posts' },
  { key: 'comment', label: 'Comments on your posts' },
  { key: 'connection_request', label: 'Connection requests' },
  { key: 'connection_accept', label: 'Accepted connections' },
  { key: 'save', label: 'Saves of your listing' },
  { key: 'review', label: 'Positive reviews of your listing' },
  { key: 'message', label: 'Direct messages' },
  { key: 'skill_endorsement', label: 'Skill endorsements' },
  { key: 'recommendation', label: 'Recommendations written about you' },
  { key: 'recommendation_accepted', label: 'Recommendations you wrote being shown' },
  { key: 'job_application', label: 'Applications to your job posts' },
];

// Create a notification for recipient_id, never notifying the actor about their own action.
export async function notify({ recipient_id, type, actor, target_type, target_id, message }){
  if(!recipient_id) return;
  if(actor && recipient_id === actor.id) return;
  try {
    await api.entities.Notification.create({
      recipient_id,
      type,
      actor_id: actor?.id || null,
      actor_name: actor?.full_name || null,
      actor_headline: actor?.headline || null,
      target_type,
      target_id: target_id || null,
      message: message || '',
      read: false
    });
  } catch {}
}

export function notificationPath(n){
  switch(n.target_type){
    case 'post': return '/feed';
    case 'user': return n.target_id ? `/profile/${n.target_id}` : '/people';
    case 'connection': return n.actor_id ? `/profile/${n.actor_id}` : '/people';
    case 'message': return n.actor_id ? `/messages/${n.actor_id}` : '/messages';
    case 'provider': return n.target_id ? `/provider/${n.target_id}` : '/directory';
    case 'skill': return '/profile';
    case 'recommendation': return '/profile';
    case 'recommendation_accepted': return n.actor_id ? `/profile/${n.actor_id}` : '/profile';
    case 'job': return n.target_id ? `/jobs/${n.target_id}` : '/jobs';
    default: return '/';
  }
}