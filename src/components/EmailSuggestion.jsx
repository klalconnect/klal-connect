import React from 'react';
import { Button } from '@/components/ui/button';

// "Did you mean eli@gmail.com?" under an email field, shown when the form
// caught a likely typo before sending anything.
export default function EmailSuggestion({ suggestion, onAccept, onKeep }) {
  if (!suggestion) return null;
  return <div role="alert" className="p-3 rounded-lg bg-primary/10 text-sm text-foreground">
    <p>Did you mean <span className="font-semibold text-brand-teal break-all">{suggestion}</span>?</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <Button type="button" size="sm" onClick={onAccept}>Yes, use that</Button>
      <Button type="button" size="sm" variant="outline" onClick={onKeep}>No, mine is right</Button>
    </div>
  </div>;
}
