import { describe, expect, it } from 'vitest';
import { closeRoomSession, directVideoUrlError, earliestActiveParticipant, expectedPlaybackPosition, youtubeVideoId } from './roomPolicy';

describe('room lifecycle policy', () => {
  it('closes only the current visit and preserves previous room sessions', () => {
    const firstJoin = new Date('2026-01-01T10:00:00Z');
    const firstLeave = new Date('2026-01-01T10:30:00Z');
    const nextJoin = new Date('2026-01-02T10:00:00Z');
    const nextLeave = new Date('2026-01-02T10:15:00Z');
    const sessions = closeRoomSession([
      { joinedAt: firstJoin, leftAt: firstLeave },
      { joinedAt: nextJoin }
    ], nextJoin, nextLeave);
    expect(sessions).toEqual([
      { joinedAt: firstJoin, leftAt: firstLeave },
      { joinedAt: nextJoin, leftAt: nextLeave }
    ]);
    expect(closeRoomSession(sessions, nextJoin, nextLeave)).toEqual(sessions);
  });

  it('chooses the earliest participant who is still active', () => {
    const participants = [
      { userId: 'host', role: 'ADMIN', isActive: false, joinedAt: '2026-01-01T00:00:00Z' },
      { userId: 'second', role: 'MEMBER', isActive: true, joinedAt: '2026-01-01T00:01:00Z' },
      { userId: 'third', role: 'MEMBER', isActive: true, joinedAt: '2026-01-01T00:02:00Z' }
    ];
    expect(earliestActiveParticipant(participants)?.userId).toBe('second');
  });

  it('returns no successor when the room is empty', () => {
    expect(earliestActiveParticipant([{ userId: 'host', isActive: false, joinedAt: new Date() }])).toBeNull();
  });

  it('advances a playing snapshot using server elapsed time', () => {
    expect(expectedPlaybackPosition({ position: 40, playing: true, updatedAt: 10_000 }, 12_500)).toBe(42.5);
  });

  it('does not advance paused playback or move backwards', () => {
    expect(expectedPlaybackPosition({ position: 40, playing: false, updatedAt: 10_000 }, 12_500)).toBe(40);
    expect(expectedPlaybackPosition({ position: 40, playing: true, updatedAt: 12_500 }, 10_000)).toBe(40);
  });

  it('extracts YouTube IDs only from official video URLs', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=tC49Nzm6SyM&list=PL123')).toBe('tC49Nzm6SyM');
    expect(youtubeVideoId('https://youtu.be/tC49Nzm6SyM')).toBe('tC49Nzm6SyM');
    expect(youtubeVideoId('https://www.youtube.com/shorts/tC49Nzm6SyM')).toBe('tC49Nzm6SyM');
    expect(youtubeVideoId('https://youtube.com.evil.example/watch?v=tC49Nzm6SyM')).toBeNull();
  });

  it('allows official YouTube video links for embedding', () => {
    expect(directVideoUrlError('https://www.youtube.com/watch?v=tC49Nzm6SyM&list=PL123')).toBeNull();
    expect(directVideoUrlError('https://youtu.be/tC49Nzm6SyM')).toBeNull();
  });

  it('rejects unsupported subscription watch pages', () => {
    expect(directVideoUrlError('https://www.netflix.com/watch/123456')).toContain('Subscription-streaming pages');
    expect(directVideoUrlError('https://www.yout-ube.com/watch?v=tC49Nzm6SyM')).toContain('official YouTube');
  });

  it('accepts direct authorized video file links', () => {
    expect(directVideoUrlError('https://media.example.org/movies/night.mp4?signature=abc')).toBeNull();
    expect(directVideoUrlError('file:///private/movie.mp4')).toContain('HTTP(S)');
  });
});
