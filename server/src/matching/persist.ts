import type { SupabaseClient } from '@supabase/supabase-js'
import type { ResolvedCluster } from './cluster.js'

const MATCH_TTL_HOURS = 72

export function makePersistCluster(
  supabase: SupabaseClient,
): (cluster: ResolvedCluster) => Promise<void> {
  return async (cluster) => {
    const expiresAt = new Date(
      Date.now() + MATCH_TTL_HOURS * 60 * 60 * 1000,
    ).toISOString()
    const { error } = await supabase.from('match_candidates').insert({
      user_ids: cluster.userIds,
      shared_theme: cluster.sharedTheme,
      room_context: cluster.roomContext,
      expires_at: expiresAt,
    })
    if (error) {
      throw new Error(`match_candidates insert failed: ${error.message}`)
    }
  }
}
