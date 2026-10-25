export type RoomParticipantLike = { isActive: boolean; joinedAt: Date | string; userId: unknown; role?: string };
export type RoomSessionLike = { joinedAt: Date | string; leftAt?: Date | string | null };

/** Reserve a fixed-window event slot synchronously before awaiting asynchronous work. */
export function reserveRateLimitSlot(timestamps: number[] | undefined, now: number, limit: number, windowMs: number): number[] | null {
  const recent = (timestamps || []).filter((timestamp) => now - timestamp < windowMs);
  return recent.length >= limit ? null : [...recent, now];
}

/** Close the latest open visit, keeping older session timestamps intact. */
export function closeRoomSession(sessions: RoomSessionLike[] | undefined, joinedAt: Date | string, leftAt: Date | string): RoomSessionLike[] {
  const updated = [...(sessions || [])];
  for (let index = updated.length - 1; index >= 0; index -= 1) {
    if (!updated[index].leftAt) {
      updated[index] = { ...updated[index], leftAt };
      return updated;
    }
  }
  if (updated.length) return updated;
  updated.push({ joinedAt, leftAt });
  return updated;
}

/** Select the earliest joined participant still active in a room. */
export function earliestActiveParticipant<T extends RoomParticipantLike>(participants: T[]): T | null {
  return participants
    .filter((participant) => participant.isActive)
    .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime())[0] ?? null;
}

/** Estimate playback position from a server-authored state snapshot. */
export function expectedPlaybackPosition(state: { position: number; playing: boolean; speed?: number; updatedAt: number }, now = Date.now()): number {
  return Math.max(0, state.position + (state.playing ? Math.max(0, now - state.updatedAt) / 1000 * (state.speed || 1) : 0));
}

/** Get an 11-character video id only from official YouTube watch/embed URLs. */
export function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be' || host === 'www.youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[0] === 'watch' ? url.searchParams.get('v') : ['embed', 'shorts', 'live'].includes(parts[0] || '') ? parts[1] : null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Accept official YouTube embeds and direct video URLs; reject other streaming/watch pages. */
export function directVideoUrlError(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Enter a direct video file URL or an official YouTube video link.';
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return 'Use a direct HTTP(S) video URL.';
  }

  const host = url.hostname.toLowerCase();
  if (youtubeVideoId(value)) return null;
  const isVideoPlatform = /youtube|youtu\.be|netflix|vimeo|twitch|dailymotion|disneyplus|primevideo/.test(host);
  const isWatchPage = /\/(watch|embed|shorts|live)(\/|$)/i.test(url.pathname) || url.searchParams.has('v');
  if (isVideoPlatform || isWatchPage) {
    return 'Use an official YouTube video link or a direct MP4, WebM, or OGG file. Subscription-streaming pages cannot be embedded here.';
  }

  return null;
}
