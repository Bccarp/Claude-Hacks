import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  listMatches,
  fetchPublicProfiles,
  type MatchCandidate,
} from "../lib/api";

type AvatarMap = Record<string, { avatar_animal: string; avatar_color: string }>;

export default function Matches() {
  const { session, signOut } = useAuth();
  const [matches, setMatches] = useState<MatchCandidate[] | null>(null);
  const [avatars, setAvatars] = useState<AvatarMap>({});
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await listMatches();
        if (cancelled) return;
        setMatches(data);
        const otherIds = Array.from(
          new Set(
            data.flatMap((m) =>
              m.user_ids.filter((id) => id !== session.user.id),
            ),
          ),
        );
        const map = await fetchPublicProfiles(otherIds);
        if (!cancelled) setAvatars(map);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-xl mx-auto px-4 py-6">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Your matches</h1>
            <p className="text-slate-400 text-sm">
              People who overlapped with you in a room
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/" className="text-slate-400 hover:text-white text-sm">
              Room
            </Link>
            <button
              onClick={signOut}
              className="text-slate-400 hover:text-white text-sm"
            >
              Sign out
            </button>
          </div>
        </header>

        {err && (
          <div className="mb-4 rounded-lg bg-rose-900/40 border border-rose-700 px-3 py-2 text-rose-200 text-sm">
            {err}
          </div>
        )}

        {matches === null && (
          <div className="text-slate-400 py-12 text-center">Loading…</div>
        )}

        {matches && matches.length === 0 && (
          <div className="text-slate-500 text-center py-12">
            No matches yet. Join a room to get paired with nearby people.
          </div>
        )}

        {matches && matches.length > 0 && (
          <ul className="space-y-3">
            {matches.map((m) => {
              const others = m.user_ids.filter(
                (id) => id !== session?.user.id,
              );
              return (
                <li key={m.id}>
                  <Link
                    to={`/matches/${m.id}`}
                    className="block bg-slate-800 hover:bg-slate-750 rounded-xl p-4 transition"
                  >
                    <p className="text-sm text-slate-400 mb-1">
                      {m.room_context}
                    </p>
                    <p className="font-semibold mb-3">{m.shared_theme}</p>
                    <div className="flex flex-wrap gap-2">
                      {others.map((id) => {
                        const a = avatars[id];
                        return (
                          <span
                            key={id}
                            className="text-xs bg-slate-700 rounded-full px-2 py-1 capitalize"
                          >
                            {a
                              ? `${a.avatar_color} ${a.avatar_animal}`
                              : "stranger"}
                          </span>
                        );
                      })}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
