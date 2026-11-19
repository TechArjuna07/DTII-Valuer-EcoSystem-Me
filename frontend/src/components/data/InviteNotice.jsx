import { Copy, MailCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/primitives';

/**
 * Outcome of an invitation. In development (MAIL_PROVIDER=log) the API also returns the one-time link so the
 * flow can be tested without an inbox; production never returns it.
 */
export function InviteNotice({ invite }) {
  if (!invite) return null;
  if (invite.existingAccount) {
    return (
      <p className="rounded-lg border border-primary/20 bg-primary-soft px-3 py-2 text-sm text-primary">
        This person already has a login. They can sign in with their existing password.
      </p>
    );
  }
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${invite.sent ? 'border-success/20 bg-success-soft text-success' : 'border-warning/30 bg-warning-soft text-warning'}`}>
      <p className="flex items-center gap-2 font-medium">
        {invite.sent ? <MailCheck className="size-4" /> : <TriangleAlert className="size-4" />}
        {invite.sent ? 'Invitation email sent.' : 'The invitation email could not be sent. Use “Resend invite” later.'}
      </p>
      {invite.devInviteUrl && (
        <div className="mt-2 rounded-md bg-card p-2 text-xs text-foreground">
          <p className="mb-1 text-muted-foreground">Development only, one-time set-password link:</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate">{invite.devInviteUrl}</code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(invite.devInviteUrl).then(() => toast.success('Link copied'))}
              aria-label="Copy invite link"
            >
              <Copy /> Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
