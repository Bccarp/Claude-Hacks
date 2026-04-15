import { useState } from "react";
import { supabase } from "../lib/supabase";

const SERVER_URL = import.meta.env.VITE_SERVER_URL as string;

export default function Login() {
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    if (mode === "signup") {
      const res = await fetch(`${SERVER_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error ?? "Sign up failed");
        setStatus("error");
        return;
      }
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
      return;
    }

    setStatus("idle");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-slate-800 rounded-2xl p-8 shadow-xl"
      >
        <h1 className="text-3xl font-bold mb-2">Proximate</h1>
        <p className="text-slate-400 text-sm mb-6">
          {mode === "signup" ? "Create an account to get started." : "Welcome back."}
        </p>

        {mode === "signup" && (
          <>
            <label className="block text-sm mb-2" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              minLength={1}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg bg-slate-700 px-3 py-2 mb-4 outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="Jordan"
            />
          </>
        )}

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

        <label className="block text-sm mb-2" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg bg-slate-700 px-3 py-2 mb-6 outline-none focus:ring-2 focus:ring-sky-400"
          placeholder="••••••••"
        />

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 py-2 font-semibold transition"
        >
          {status === "loading"
            ? "Please wait…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </button>

        {errorMsg && (
          <p className="mt-4 text-rose-300 text-sm">{errorMsg}</p>
        )}

        <p className="mt-6 text-center text-sm text-slate-400">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signin"); setErrorMsg(""); }}
                className="text-sky-400 hover:underline"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signup"); setErrorMsg(""); }}
                className="text-sky-400 hover:underline"
              >
                Create one
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
