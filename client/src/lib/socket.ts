import { io, type Socket } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL as string;

if (!SERVER_URL) {
  throw new Error("VITE_SERVER_URL must be set in the client env");
}

export interface ConnectOptions {
  token: string;
  coords?: { lat: number; lng: number };
  code?: string;
}

export function connectRoom(opts: ConnectOptions): Socket {
  const auth: Record<string, unknown> = { token: opts.token };
  if (opts.coords) {
    auth.lat = opts.coords.lat;
    auth.lng = opts.coords.lng;
  }
  if (opts.code) {
    auth.code = opts.code;
  }
  return io(SERVER_URL, {
    auth,
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 5,
  });
}

export const REACTION_EMOJIS = ["😕", "🔥", "👍", "🤔", "🙌"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface PublicPost {
  postId: string;
  type: "question" | "note";
  text: string;
  reactions: Record<string, number>;
  flagCount: number;
  createdAt: number;
}
