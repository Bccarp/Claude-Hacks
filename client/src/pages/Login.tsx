import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string>("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-slate-800 rounded-2xl p-8 shadow-xl"
      >
        <h1 className="text-3xl font-bold mb-6">Proximate</h1>
        <p className="text-slate-300 mb-6">
          Sign in with a magic link. We'll email you a login link.
        </p>
        <label className="block text-sm mb-2" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg bg-slate-700 px-3 py-2 mb-4 outline-none focus:ring-2 focus:ring-sky-400"
          placeholder="you@school.edu"
        />
        <button
          type="submit"
          disabled={status === "sending" || status === "sent"}
          className="w-full rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 py-2 font-semibold transition"
        >
          {status === "sending"
            ? "Sending…"
            : status === "sent"
              ? "Check your inbox"
              : "Send magic link"}
        </button>
        {status === "error" && (
          <p className="mt-4 text-rose-300 text-sm">{errorMsg}</p>
        )}
      </form>
    </div>
  );
}
