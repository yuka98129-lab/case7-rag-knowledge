"use client";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getBrowserSupabase, isConfigured } from "./supabase-browser";

export type SessionState = { loading: boolean; session: Session | null; configured: boolean };

export function useSession(): SessionState {
  const configured = isConfigured();
  const [state, setState] = useState<{ loading: boolean; session: Session | null }>({ loading: configured, session: null });

  useEffect(() => {
    if (!configured) return;
    const supabase = getBrowserSupabase();
    supabase.auth.getSession().then(({ data }) => setState({ loading: false, session: data.session }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ loading: false, session }));
    return () => data.subscription.unsubscribe();
  }, [configured]);

  return { ...state, configured };
}

export const authHeader = (session: Session | null): Record<string, string> =>
  session ? { Authorization: `Bearer ${session.access_token}` } : {};
