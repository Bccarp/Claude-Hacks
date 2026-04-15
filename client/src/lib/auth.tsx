import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, fetchProfile, type Profile } from "./supabase";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      if (data.session) {
        try {
          const p = await fetchProfile(data.session.user.id);
          setProfile(p);
        } catch {
          setProfile(null);
        }
      }
      setLoading(false);

      const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
        setSession(s);
        if (s) {
          try {
            const p = await fetchProfile(s.user.id);
            setProfile(p);
          } catch {
            setProfile(null);
          }
        } else {
          setProfile(null);
        }
      });
      unsub = () => sub.subscription.unsubscribe();
    })();
    return () => {
      if (unsub) unsub();
    };
  }, []);

  async function refreshProfile() {
    if (!session) return;
    const p = await fetchProfile(session.user.id);
    setProfile(p);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, refreshProfile, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
