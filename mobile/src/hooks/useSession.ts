import type { AuthSession } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export interface UseSessionResult {
  session: AuthSession | null;
  loading: boolean;
}

// Single source of truth for the signed-in state (SPEC.md - Mobile UI/UX -
// Auth): resolve the persisted session once on mount, then fold every auth
// event (sign-in, sign-out, token refresh) into local state until unmount.
export function useSession(): UseSessionResult {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) {
        return;
      }
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}
