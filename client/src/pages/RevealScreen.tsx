import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { dismissMatch, type RevealProfile } from "../lib/api";

interface LocationState {
  me?: RevealProfile;
  them?: RevealProfile;
}

export default function RevealScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;
  const [dismissing, setDismissing] = useState(false);
  const [err, setErr] = useState<string>("");

  const me = state.me;
  const them = state.them;

  async function onDone() {
    if (!matchId) return;
    setDismissing(true);
    try {
      await dismissMatch(matchId);
    } catch (e) {
      setErr((e as Error).message);
      setDismissing(false);
      return;
    }
    navigate("/matches", { replace: true });
  }

  if (!me || !them) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <p className="text-slate-300 mb-4">
            This reveal isn't available. Open the match from your list.
          </p>
          <button
            onClick={() => navigate("/matches", { replace: true })}
            className="rounded-lg bg-sky-500 hover:bg-sky-400 px-4 py-2 font-semibold"
          >
            Back to matches
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-slate-800 rounded-2xl p-8 shadow-xl">
        <p className="text-center text-emerald-300 uppercase tracking-wide text-xs font-semibold mb-2">
          It's a match
        </p>
        <h1 className="text-2xl font-bold text-center mb-6">Say hi</h1>

        <ProfileCard profile={them} label="Them" />
        <div className="h-3" />
        <ProfileCard profile={me} label="You" />

        {err && (
          <div className="mt-4 rounded-lg bg-rose-900/40 border border-rose-700 px-3 py-2 text-rose-200 text-sm">
            {err}
          </div>
        )}

        <p className="text-slate-400 text-sm text-center mt-6">
          Reach out with their contact. After you close this, the match is
          cleared from your list.
        </p>
        <button
          onClick={onDone}
          disabled={dismissing}
          className="mt-4 w-full rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 py-2 font-semibold transition"
        >
          {dismissing ? "Closing…" : "Done"}
        </button>
      </div>
    </div>
  );
}

function ProfileCard({
  profile,
  label,
}: {
  profile: RevealProfile;
  label: string;
}) {
  return (
    <div className="bg-slate-700 rounded-xl p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">
        {label}
      </p>
      <p className="text-lg font-semibold">{profile.display_name}</p>
      <p className="text-sm text-slate-300 capitalize">
        {profile.avatar_color} {profile.avatar_animal}
      </p>
      {profile.contact_handle && (
        <p className="mt-2 font-mono text-sky-200 break-words">
          {profile.contact_handle}
        </p>
      )}
    </div>
  );
}
