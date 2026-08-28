'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { acceptInvite, peekInvite } from '@/lib/teams';
import { Loader2, Users, AlertCircle } from 'lucide-react';

const ACTIVE_TEAM_KEY = 'veracity-active-team';

function InviteAcceptContent() {
  const params = useParams();
  const router = useRouter();
  const token = typeof params.token === 'string' ? params.token : '';

  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    teamName: string;
    email: string;
    role: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      if (!token) {
        setError('Invalid invite link');
        setLoading(false);
        return;
      }

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setSignedIn(!!user);
      setUserEmail(user?.email ?? null);

      try {
        const peek = await peekInvite(token);
        setInvite({
          teamName: peek.teamName,
          email: peek.email,
          role: peek.role,
          expiresAt: peek.expiresAt,
        });

        if (user) {
          setAccepting(true);
          try {
            const result = await acceptInvite(token);
            localStorage.setItem(ACTIVE_TEAM_KEY, result.teamId);
            router.replace('/?tab=shared');
            return;
          } catch (e) {
            const err = e as Error & { code?: string };
            setError(err.message);
          } finally {
            setAccepting(false);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invite not found or expired');
      } finally {
        setLoading(false);
      }
    }

    void init();
  }, [token, router]);

  async function signInWithGoogle() {
    const supabase = createClient();
    const next = encodeURIComponent(`/invite/${token}`);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${next}`,
      },
    });
  }

  async function tryAccept() {
    setAccepting(true);
    setError(null);
    try {
      const result = await acceptInvite(token);
      localStorage.setItem(ACTIVE_TEAM_KEY, result.teamId);
      router.replace('/?tab=shared');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept invite');
    } finally {
      setAccepting(false);
    }
  }

  if (loading || accepting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 size={24} className="animate-spin text-accent" />
        <p className="text-sm font-mono text-muted-foreground">
          {accepting ? 'Joining team…' : 'Loading invite…'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="veracity-card max-w-md w-full p-8 flex flex-col gap-5 text-center">
        <Users size={36} className="mx-auto text-accent" />

        {invite ? (
          <>
            <h1 className="font-serif text-2xl font-semibold text-foreground">
              Join {invite.teamName}
            </h1>
            <p className="text-sm text-muted-foreground">
              You&apos;ve been invited as <span className="font-mono text-foreground">{invite.role}</span>
            </p>
            <p className="text-xs font-mono text-muted-foreground">
              Invite sent to {invite.email}
            </p>
          </>
        ) : (
          <h1 className="font-serif text-xl font-semibold text-foreground">Team invite</h1>
        )}

        {error ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-left">
            <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        ) : null}

        {signedIn && invite && !error ? (
          <button
            type="button"
            onClick={() => void tryAccept()}
            disabled={accepting}
            className="w-full py-3 rounded-xl bg-gradient-signature text-white font-medium disabled:opacity-50"
          >
            Accept invite
          </button>
        ) : null}

        {!signedIn && invite ? (
          <>
            <p className="text-sm text-muted-foreground">
              Sign in with the Google account that received this invite.
            </p>
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="w-full py-3 rounded-xl bg-gradient-signature text-white font-medium"
            >
              Sign in with Google
            </button>
          </>
        ) : null}

        {signedIn && userEmail ? (
          <p className="text-[11px] font-mono text-muted-foreground">
            Signed in as {userEmail}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => router.push('/')}
          className="text-xs font-mono text-muted-foreground hover:text-foreground"
        >
          Back to app
        </button>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      }
    >
      <InviteAcceptContent />
    </Suspense>
  );
}
