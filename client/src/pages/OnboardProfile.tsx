import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { randomAvatar } from "../lib/avatar";

export default function OnboardProfile() {
  const { session, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [contactHandle, setContactHandle] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>("");
  const avatar = useMemo(() => randomAvatar(), []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setSaving(true);
    setErr("");
    const { error } = await supabase.from("profiles").insert({
      id: session.user.id,
      display_name: displayName.trim(),
      avatar_animal: avatar.animal,
      avatar_color: avatar.color,
      contact_handle: contactHandle.trim() || null,
    });
    if (error) {
      setErr(error.message);
      setSaving(false);
      return;
    }
    await refreshProfile();
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md bg-slate-800 rounded-2xl p-8 shadow-xl"
      >
        <h1 className="text-2xl font-bold mb-2">One last thing</h1>
        <p className="text-slate-300 mb-6">
          You'll appear to nearby folks as{" "}
          <span className="font-semibold capitalize">
            {avatar.color} {avatar.animal}
          </span>
          . If someone matches with you and you both reveal, they'll see your
          display name and contact handle.
        </p>

        <label className="block text-sm mb-2" htmlFor="displayName">
          Display name
        </label>
        <input
          id="displayName"
          required
          minLength={1}
          maxLength={40}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-lg bg-slate-700 px-3 py-2 mb-4 outline-none focus:ring-2 focus:ring-sky-400"
          placeholder="Jordan"
        />

        <label className="block text-sm mb-2" htmlFor="contactHandle">
          Contact handle{" "}
          <span className="text-slate-400">(e.g. @you on instagram)</span>
        </label>
        <input
          id="contactHandle"
          maxLength={80}
          value={contactHandle}
          onChange={(e) => setContactHandle(e.target.value)}
          className="w-full rounded-lg bg-slate-700 px-3 py-2 mb-6 outline-none focus:ring-2 focus:ring-sky-400"
          placeholder="@jordan"
        />

        <button
          type="submit"
          disabled={saving || !displayName.trim()}
          className="w-full rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 py-2 font-semibold transition"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
        {err && <p className="mt-4 text-rose-300 text-sm">{err}</p>}
      </form>
    </div>
  );
}
