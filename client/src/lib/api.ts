import { supabase } from "./supabase";

const SERVER_URL = import.meta.env.VITE_SERVER_URL as string;

if (!SERVER_URL) {
  throw new Error("VITE_SERVER_URL must be set in the client env");
}

export interface MatchCandidate {
  id: string;
  user_ids: string[];
  shared_theme: string;
  room_context: string;
  created_at: string;
  expires_at: string;
}

export interface RevealProfile {
  id: string;
  display_name: string;
  avatar_animal: string;
  avatar_color: string;
  contact_handle: string | null;
}

export type RevealResult =
  | { status: "pending" }
  | { status: "revealed"; me: RevealProfile; them: RevealProfile }
  | { status: "interest_not_declared" };

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("not_authenticated");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function listMatches(): Promise<MatchCandidate[]> {
  const res = await fetch(`${SERVER_URL}/api/matches`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`list_matches_failed_${res.status}`);
  const body = (await res.json()) as { matches: MatchCandidate[] };
  return body.matches;
}

export async function declareInterest(
  matchId: string,
  targetUserId: string,
): Promise<void> {
  const res = await fetch(
    `${SERVER_URL}/api/matches/${matchId}/interest`,
    {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ targetUserId }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `interest_failed_${res.status}`);
  }
}

export async function fetchReveal(
  matchId: string,
  otherUserId: string,
): Promise<RevealResult> {
  const res = await fetch(
    `${SERVER_URL}/api/matches/${matchId}/reveal/${otherUserId}`,
    { headers: await authHeaders() },
  );
  if (res.status === 202) return { status: "pending" };
  if (res.status === 400) {
    const body = await res.json().catch(() => ({}));
    if (body?.error === "interest_not_declared") {
      return { status: "interest_not_declared" };
    }
  }
  if (!res.ok) throw new Error(`reveal_failed_${res.status}`);
  const body = (await res.json()) as {
    status: "revealed";
    me: RevealProfile;
    them: RevealProfile;
  };
  return body;
}

export async function dismissMatch(matchId: string): Promise<void> {
  const res = await fetch(`${SERVER_URL}/api/matches/${matchId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`dismiss_failed_${res.status}`);
  }
}

export async function fetchPublicProfiles(
  userIds: string[],
): Promise<Record<string, { avatar_animal: string; avatar_color: string }>> {
  if (userIds.length === 0) return {};
  const { data, error } = await supabase
    .from("profiles")
    .select("id, avatar_animal, avatar_color")
    .in("id", userIds);
  if (error) throw error;
  const map: Record<string, { avatar_animal: string; avatar_color: string }> =
    {};
  for (const row of data ?? []) {
    map[row.id as string] = {
      avatar_animal: row.avatar_animal as string,
      avatar_color: row.avatar_color as string,
    };
  }
  return map;
}
