import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  declareInterest,
  fetchPublicProfiles,
  fetchReveal,
  listMatches,
  type MatchCandidate,
  type RevealProfile,
} from "../lib/api";

type AvatarMap = Record<string, { avatar_animal: string; avatar_color: string }>;

type InterestState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "pending" }
  | { kind: "error"; message: string };

export default function MatchDetail() {
  const { matchId } = useParams<{ matchId: string }>();
  const { session } = useAuth();
  const navigate = useNavigate();

  const [match, setMatch] = useState<MatchCandidate | null>(null);
  const [avatars, setAvatars] = useState<AvatarMap>({});
  const [err, setErr] = useState<string>("");
  const [target, setTarget] = useState<string | null>(null);
  const [state, setState] = useState<InterestState>({ kind: "idle" });
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!session || !matchId) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await listMatches();
        const found = all.find((m) => m.id === matchId) ?? null;
        if (cancelled) return;
        setMatch(found);
        if (found) {
          const others = found.user_ids.filter((id) => id !== session.user.id);
          const map = await fetchPublicProfiles(others);
          if (!cancelled) setAvatars(map);
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, matchId]);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  async function onDeclareInterest(targetUserId: string) {
    if (!matchId) return;
    setTarget(targetUserId);
    setState({ kind: "sending" });
    try {
      await declareInterest(matchId, targetUserId);
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
      return;
    }
    setState({ kind: "pending" });
    const poll = async () => {
      if (!matchId) return;
      try {
        const result = await fetchReveal(matchId, targetUserId);
        if (result.status === "revealed") {
          if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
          goReveal(matchId, result.me, result.them);
        }
      } catch (e) {
        setState({ kind: "error", message: (e as Error).message });
      }
    };
    await poll();
    pollRef.current = window.setInterval(poll, 10_000);
  }

  function goReveal(
    matchId: string,
    me: RevealProfile,
    them: RevealProfile,
  ) {
    navigate(`/matches/${matchId}/reveal`, {
      state: { me, them },
      replace: true,
    });
  }

  if (!session) return null;

  if (err) {
    return (
      <Shell>
        <div className="rounded-lg bg-rose-900/40 border border-rose-700 px-3 py-2 text-rose-200 text-sm">
          {err}
        </div>
      </Shell>
    );
  }

  if (match === null) {
    return (
      <Shell>
        <div className="text-slate-400 py-12 text-center">Loading…</div>
      </Shell>
    );
  }

  const others = match.user_ids.filter((id) => id !== session.user.id);

  return (
    <Shell>
      <div className="mb-6">
        <p className="text-sm text-slate-400">{match.room_context}</p>
        <h1 className="text-2xl font-bold mt-1">{match.shared_theme}</h1>
      </div>

      <p className="text-slate-300 mb-3">
        Tap someone to let them know you'd like to connect. They'll see your
        name and contact only if they also pick you.
      </p>

      <ul className="space-y-3">
        {others.map((id) => {
          const a = avatars[id];
          const isTarget = target === id;
          return (
            <li
              key={id}
              className="bg-slate-800 rounded-xl p-4 flex items-center justify-between"
            >
              <span className="capitalize font-medium">
                {a ? `${a.avatar_color} ${a.avatar_animal}` : "stranger"}
              </span>
              {isTarget && state.kind === "pending" ? (
                <span className="text-sm text-amber-200">
                  Waiting on them…
                </span>
              ) : isTarget && state.kind === "sending" ? (
                <span className="text-sm text-slate-400">Sending…</span>
              ) : isTarget && state.kind === "error" ? (
                <span className="text-sm text-rose-300">{state.message}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onDeclareInterest(id)}
                  disabled={target !== null && target !== id}
                  className="rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 px-3 py-1.5 text-sm font-semibold transition"
                >
                  I'm interested
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-xl mx-auto px-4 py-6">
        <Link
          to="/matches"
          className="text-slate-400 hover:text-white text-sm"
        >
          ← Back to matches
        </Link>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
