import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Socket } from "socket.io-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  connectRoom,
  type PublicPost,
  type ReactionEmoji,
} from "../lib/socket";
import PostList from "../components/PostList";
import Composer from "../components/Composer";

type GeoState =
  | { kind: "idle" }
  | { kind: "prompting" }
  | { kind: "granted"; coords: { lat: number; lng: number } }
  | { kind: "denied" }
  | { kind: "unsupported" };

type RoomPhase = "connecting" | "live" | "closing" | "dead";

export default function Room() {
  const { session, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });
  const [phase, setPhase] = useState<RoomPhase>("connecting");
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [socketErr, setSocketErr] = useState<string>("");
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeo({ kind: "unsupported" });
      return;
    }
    setGeo({ kind: "prompting" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          kind: "granted",
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        });
      },
      (err) => {
        console.warn("geolocation error", err);
        setGeo({ kind: "denied" });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    if (!session) return;
    if (geo.kind !== "granted") return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      const sock = connectRoom({ token, coords: geo.coords });
      socketRef.current = sock;
      wireSocket(sock, {
        setPhase,
        setPosts,
        setErr: setSocketErr,
        onDead: () => navigate("/matches", { replace: true }),
      });
    })();
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [session, geo, navigate]);

  function onCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(codeInput)) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const sock = connectRoom({ token, code: codeInput });
      socketRef.current = sock;
      wireSocket(sock, {
        setPhase,
        setPosts,
        setErr: setSocketErr,
        onDead: () => navigate("/matches", { replace: true }),
      });
    })();
  }

  function handlePost(payload: { type: "question" | "note"; text: string }) {
    socketRef.current?.emit("post:new", payload);
  }

  function handleReact(postId: string, emoji: ReactionEmoji) {
    socketRef.current?.emit("reaction:add", { postId, emoji });
  }

  function handleFlag(postId: string) {
    if (!confirm("Flag this post as inappropriate?")) return;
    socketRef.current?.emit("post:flag", { postId });
  }

  if (geo.kind === "idle" || geo.kind === "prompting") {
    return <FullCenter>Requesting your location…</FullCenter>;
  }

  if (geo.kind === "denied" || geo.kind === "unsupported") {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
        <form
          onSubmit={onCodeSubmit}
          className="w-full max-w-sm bg-slate-800 rounded-2xl p-8 shadow-xl"
        >
          <h1 className="text-2xl font-bold mb-2">Join with a code</h1>
          <p className="text-slate-300 mb-6 text-sm">
            We can't use your location. Ask someone nearby to share a 6-digit
            code and enter it below.
          </p>
          <input
            value={codeInput}
            onChange={(e) =>
              setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="123456"
            inputMode="numeric"
            maxLength={6}
            className="w-full rounded-lg bg-slate-700 px-3 py-2 mb-4 outline-none text-center text-2xl tracking-widest font-mono focus:ring-2 focus:ring-sky-400"
          />
          <button
            type="submit"
            disabled={codeInput.length !== 6}
            className="w-full rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 py-2 font-semibold transition"
          >
            Join
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-xl mx-auto px-4 py-6">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Nearby</h1>
            {profile && (
              <p className="text-slate-400 text-sm capitalize">
                You are {profile.avatar_color} {profile.avatar_animal}
              </p>
            )}
          </div>
          <button
            onClick={signOut}
            className="text-slate-400 hover:text-white text-sm"
          >
            Sign out
          </button>
        </header>

        {socketErr && (
          <div className="mb-4 rounded-lg bg-rose-900/40 border border-rose-700 px-3 py-2 text-rose-200 text-sm">
            {socketErr}
          </div>
        )}

        <PostList
          posts={posts}
          disabled={phase !== "live"}
          onReact={handleReact}
          onFlag={handleFlag}
        />

        <div className="mt-6">
          <Composer disabled={phase !== "live"} onSubmit={handlePost} />
        </div>

        {phase === "closing" && (
          <Overlay>
            <h2 className="text-xl font-semibold mb-2">Session ended</h2>
            <p className="text-slate-300">
              Matching nearby people now. Hang tight…
            </p>
          </Overlay>
        )}
        {phase === "connecting" && (
          <Overlay>
            <p className="text-slate-300">Connecting to the room…</p>
          </Overlay>
        )}
      </div>
    </div>
  );
}

interface WireArgs {
  setPhase: (p: RoomPhase) => void;
  setPosts: React.Dispatch<React.SetStateAction<PublicPost[]>>;
  setErr: (s: string) => void;
  onDead: () => void;
}

function wireSocket(sock: Socket, args: WireArgs) {
  sock.on("connect", () => {
    args.setErr("");
  });
  sock.on("connect_error", (err) => {
    args.setErr(err.message || "connection error");
  });
  sock.on("room:state", (payload: { feed: PublicPost[] }) => {
    args.setPosts(payload.feed);
    args.setPhase("live");
  });
  sock.on("post:new", (post: PublicPost) => {
    args.setPosts((prev) => {
      if (prev.some((p) => p.postId === post.postId)) return prev;
      return [post, ...prev];
    });
  });
  sock.on(
    "reaction:update",
    (payload: { postId: string; reactions: Record<string, number> }) => {
      args.setPosts((prev) =>
        prev.map((p) =>
          p.postId === payload.postId
            ? { ...p, reactions: payload.reactions }
            : p,
        ),
      );
    },
  );
  sock.on("post:hidden", (payload: { postId: string }) => {
    args.setPosts((prev) => prev.filter((p) => p.postId !== payload.postId));
  });
  sock.on("room:closing", () => {
    args.setPhase("closing");
  });
  sock.on("room:dead", () => {
    args.setPhase("dead");
    args.onDead();
  });
  sock.on("error", (payload: { code?: string; event?: string }) => {
    if (payload?.code) {
      args.setErr(`${payload.code}${payload.event ? ` (${payload.event})` : ""}`);
    }
  });
}

function FullCenter({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-300">
      {children}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-6">
      <div className="bg-slate-800 rounded-2xl p-6 text-center max-w-sm">
        {children}
      </div>
    </div>
  );
}
