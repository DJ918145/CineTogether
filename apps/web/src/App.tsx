import { createContext, FormEvent, Suspense, useContext, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { ArrowDownLeft, ArrowLeft, ArrowRight, Check, ChevronDown, Clapperboard, Copy, Crown, Film, LogOut, MessageCircle, Play, Plus, Send, Settings2, Shield, Sparkles, Users, Volume2, VolumeX, X, Maximize, LockKeyhole, LoaderCircle, Camera, UserRound, Mail, KeyRound, BadgeCheck, Clock3 } from 'lucide-react';
import { API, post, request, updateRoomSettings, uploadWithProgress } from './api';

type User = { id: string; name: string; email: string; avatar?: string; authProviders?: { password: boolean; google: boolean } };
type AuthValue = { user: User | null; setUser: (user: User | null) => void; loading: boolean };
const AuthContext = createContext<AuthValue>({ user: null, setUser: () => {}, loading: true });
const useAuth = () => useContext(AuthContext);
type Participant = { userId: string | { _id?: string; name?: string }; role: string; isActive: boolean; joinedAt: string; name?: string };
type Room = { _id: string; roomCode: string; name: string; description?: string; status: string; visibility: string; maxParticipants: number; ownerId: string; currentMedia?: { title: string; url: string; mimeType?: string }; participants: Participant[] };
type Message = { _id: string; senderId: string; senderName: string; message: string; messageType: string; createdAt: string };
type MediaItem = { _id: string; title: string; description?: string; sourceUrl: string; sourceType?: 'upload' | 'url'; duration?: number; mimeType?: string; createdAt?: string };
type HistoryVisit = { joinedAt: string; leftAt: string | null };
type HistoryParticipant = { name: string; role: string; isActive: boolean; sessions: HistoryVisit[] };
type HistoryMessage = { _id: string; senderName: string; message: string; messageType: string; createdAt: string };
type HistoryMovie = { title: string; url?: string; mimeType?: string; selectedAt: string };
type HistoryDetails = { currentMedia?: Room['currentMedia']; movieHistory: HistoryMovie[]; messages: HistoryMessage[]; participants: HistoryParticipant[] };
type JoinedRoomHistory = HistoryDetails & { roomId: string; roomCode: string; roomName: string; roomStatus: string; joinedAt: string; leftAt: string | null; isActive: boolean; visits: HistoryVisit[] };
type CreatedRoomHistory = HistoryDetails & { _id: string; roomCode: string; name: string; description?: string; status: string; createdAt: string };
const uid = (p: Participant) => typeof p.userId === 'string' ? p.userId : p.userId?._id || '';
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const youtubeIdFromUrl = (value: string) => {
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
  } catch { return null; }
};
type YouTubePlayerInstance = { playVideo: () => void; pauseVideo: () => void; seekTo: (seconds: number, allowSeekAhead: boolean) => void; getCurrentTime: () => number; getDuration: () => number; getPlayerState: () => number; setVolume: (volume: number) => void; mute: () => void; unMute: () => void; setPlaybackRate: (rate: number) => void; destroy: () => void };
type YouTubeApi = { Player: new (element: HTMLElement, options: { videoId: string; playerVars?: Record<string, string | number>; events: { onReady: (event: { target: YouTubePlayerInstance }) => void; onStateChange: (event: { data: number; target: YouTubePlayerInstance }) => void; onError: () => void } }) => YouTubePlayerInstance; PlayerState: { ENDED: number; PLAYING: number } };
declare global { interface Window { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void } }
let youtubeApiPromise: Promise<void> | undefined;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise<void>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previousReady?.(); resolve(); };
    let script = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) { script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.async = true; document.head.appendChild(script); }
    script.addEventListener('error', () => { youtubeApiPromise = undefined; reject(new Error('Could not load YouTube’s official player.')); }, { once: true });
  });
  return youtubeApiPromise;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { request<{ user: User }>('/auth/me').then((data) => setUser(data.user)).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  return <AuthContext.Provider value={{ user, setUser, loading }}><Suspense fallback={<div className="screen-loading"><LoaderCircle className="spin" /></div>}><Routes>
    <Route path="/" element={<Landing />} /><Route path="/privacy" element={<PolicyPage kind="privacy" />} /><Route path="/terms" element={<PolicyPage kind="terms" />} /><Route path="/login" element={<AuthPage />} /><Route path="/register" element={<AuthPage signup />} /><Route path="/forgot-password" element={<AuthPage reset />} />
    <Route path="/app" element={<Protected><Dashboard /></Protected>} /><Route path="/history" element={<Protected><HistoryPage /></Protected>} /><Route path="/profile" element={<Protected><ProfilePage /></Protected>} /><Route path="/room/:code" element={<Protected><RoomPage /></Protected>} /><Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense></AuthContext.Provider>;
}
function Brand({ small = false }: { small?: boolean }) { return <Link className={`brand ${small ? 'brand-small' : ''}`} to="/"><span className="brand-mark"><Clapperboard size={19} /></span><span>Cine<span className="gradient-text">Together</span></span></Link>; }
function GoogleMark() { return <svg aria-hidden="true" className="google-mark" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.75 7.18l7.73 6C44.42 38.01 47 31.84 47 24.55Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.13 1.43-4.87 2.28-8.18 2.28-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.2C6.51 42.62 14.62 48 24 48Z"/></svg>; }
function Landing() {
  const { user } = useAuth();
  return <main className="landing">
    <nav className="nav-wrap"><Brand /><div className="nav-links"><a href="#how">How it works</a><a href="#features">Features</a></div><div className="nav-actions">{user ? <Link className="button button-soft" to="/app">Open dashboard <ArrowRight size={16} /></Link> : <><Link className="nav-login" to="/login">Log in</Link><Link className="button button-primary button-sm" to="/register">Get started <ArrowRight size={15} /></Link></>}</div></nav>
    <section className="hero"><div className="hero-glow" /><div className="hero-copy"><div className="eyebrow"><span className="pulse-dot" /> YOUR PEOPLE, ONE PLAY BUTTON</div><h1>Your Friends.<br />Your Movie.<br /><span className="gradient-text">One Perfect Night.</span></h1><p>Create a room, invite your people, and experience movies together — wherever life takes you.</p><div className="hero-actions"><Link className="button button-primary" to={user ? '/app' : '/register'}>Start movie night <ArrowRight size={17} /></Link><Link className="button button-outline" to={user ? '/app' : '/login'}>Join a room <ArrowDownLeft size={17} /></Link></div><div className="social-proof"><div className="avatar-stack"><span>J</span><span>M</span><span>A</span><span>+</span></div><span>Good movies are better together.</span></div></div><div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="poster poster-back"><span>TONIGHT'S PICK</span><b>AFTER<br />HOURS</b><small>A little closer, together.</small></div><div className="poster poster-front"><div className="poster-scene"><div className="moon"/><div className="hill hill-one"/><div className="hill hill-two"/><div className="tiny-house"/></div><span className="poster-kicker">A CINE TOGETHER ORIGINAL</span><b>THE<br/><i>LONG WAY</i><br/>HOME</b><small>Somewhere, someone is watching with you.</small></div><div className="floating-card watching"><span className="live-dot"/> <b>Movie night is live</b><span>3 friends watching</span><div className="mini-faces"><i>D</i><i>R</i><i>P</i></div></div><div className="floating-card synced"><span className="synced-icon"><Check size={14}/></span><div><b>All in sync</b><small>Right on cue</small></div></div><div className="play-badge"><Play fill="currentColor" size={18}/></div></div></section>
    <section id="how" className="how-section"><div className="section-head"><span className="eyebrow">THREE LITTLE STEPS</span><h2>Make a night of it.</h2><p>Less planning. More “did you see that?”</p></div><div className="steps-grid"><Step number="01" icon={<Plus/>} title="Create a room" text="Set up your private theater in seconds. Pick a name, make it yours."/><Step number="02" icon={<Users/>} title="Invite your people" text="Send a room link to your favorite humans. No awkward setup required."/><Step number="03" icon={<Play/>} title="Press play, together" text="Every laugh, gasp, and “wait, pause!” happens in sync."/></div></section>
    <section id="features" className="feature-banner"><div className="feature-copy"><span className="eyebrow">A BETTER KIND OF SCREEN TIME</span><h2>Same movie.<br/><span className="gradient-text">Same moment.</span></h2><p>Shared reactions, a cozy chat, and playback that keeps everyone together. It’s the next best thing to being on the same couch.</p><Link to={user ? '/app' : '/register'} className="text-link">Find your people <ArrowRight size={16}/></Link></div><div className="feature-screen"><div className="screen-top"><span><i className="live-dot"/> LIVE ROOM</span><span><Users size={13}/> 3 watching</span></div><div className="screen-content"><div className="screen-moon"/><span>NOW WATCHING</span><strong>THE<br/>QUIET<br/>BETWEEN</strong><div className="screen-play"><Play fill="currentColor" size={20}/></div></div><div className="screen-controls"><span>01:24:08</span><div><i/></div><span>02:01:42</span></div></div></section>
    <footer className="footer"><Brand small/><span>Watch together. Feel together.</span><div><a href="#how">About</a><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><a href="mailto:hello@cinetogether.app">Contact</a></div><small>© {new Date().getFullYear()} CineTogether. Made for movie people.</small></footer>
  </main>;
}
function PolicyPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const privacy = kind === 'privacy';
  return <div className="app-shell">
    <header className="app-header"><Brand small /><Link className="button button-soft button-sm" to="/">Back to home</Link></header>
    <main className="policy-page">
      <div className="profile-heading"><span className="eyebrow">CINETOGETHER · {privacy ? 'PRIVACY' : 'TERMS'}</span><h1>{privacy ? 'Privacy overview' : 'Terms of use'}</h1><p>{privacy ? 'What information is used to make shared movie nights work.' : 'A few ground rules for a good movie night together.'}</p></div>
      <section className="profile-card policy-card">
        <p className="policy-notice">This is a plain-language product summary, not a complete legal policy. Please contact us with questions or requests at <a href="mailto:hello@cinetogether.app">hello@cinetogether.app</a>.</p>
        {privacy ? <>
          <h2>Information used by the app</h2>
          <p>CineTogether uses your account name and email address, plus an optional profile photo URL. When you use rooms, it stores room details, participant join and leave times, selected video links, and chat messages or reactions so room features and history can work.</p>
          <h2>How information is used and shared</h2>
          <p>Account information is used to sign you in and display your identity in rooms. Room details, messages, reactions, and selected video information are visible to people in that room. When you play an embedded video, your browser also connects to the video provider.</p>
          <h2>Account questions</h2>
          <p>For questions or requests about your account information, contact <a href="mailto:hello@cinetogether.app">hello@cinetogether.app</a>. Do not send your password or sign-in codes by email.</p>
        </> : <>
          <h2>Use media you are allowed to share</h2>
          <p>Only add or share video links that you are authorized to access and share. CineTogether supports official YouTube embeds and authorized direct video links; it does not provide a way to bypass access controls or protected streams.</p>
          <h2>Respect other people in the room</h2>
          <p>Room participants should use chat and reactions respectfully. The room administrator controls shared playback and selected media.</p>
          <h2>Questions</h2>
          <p>If you have questions about using CineTogether, contact <a href="mailto:hello@cinetogether.app">hello@cinetogether.app</a>.</p>
        </>}
      </section>
    </main>
  </div>;
}
function Step({ number, icon, title, text }: { number: string; icon: React.ReactNode; title: string; text: string }) { return <article className="step-card"><div className="step-top"><span className="step-icon">{icon}</span><span>{number}</span></div><h3>{title}</h3><p>{text}</p></article>; }
function Protected({ children }: { children: React.ReactNode }) { const { user, loading } = useAuth(); if (loading) return <div className="screen-loading"><LoaderCircle className="spin"/></div>; return user ? <>{children}</> : <Navigate to="/login" replace />; }
function ProfilePage() {
  const { user, setUser } = useAuth(); const nav = useNavigate();
  const [name, setName] = useState(user?.name || ''); const [avatar, setAvatar] = useState(user?.avatar || '');
  const [error, setError] = useState(''); const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { setName(user?.name || ''); setAvatar(user?.avatar || ''); }, [user?.id]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSaved(false); setBusy(true);
    try { const result = await request<{ user: User }>('/auth/profile', { method: 'PATCH', body: JSON.stringify({ name, avatar }) }); setUser(result.user); setSaved(true); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save your profile.'); }
    finally { setBusy(false); }
  };
  const logout = async () => { await post('/auth/logout'); setUser(null); nav('/'); };
  return <div className="app-shell"><header className="app-header"><Brand small/><div className="dashboard-top-right"><Link className="button button-soft button-sm" to="/app"><ArrowLeft size={14}/> Dashboard</Link><button className="profile-button" onClick={logout}><LogOut size={15}/> <span>Sign out</span></button></div></header><main className="profile-page"><div className="profile-heading"><span className="eyebrow">YOUR ACCOUNT, YOUR WAY</span><h1>Your profile</h1><p>A few details so your friends know who’s joining movie night.</p></div><form className="profile-card" onSubmit={submit}><div className="profile-card-head"><div className="profile-avatar-large">{avatar ? <img src={avatar} alt="Profile" onError={(event) => { event.currentTarget.style.display = 'none'; }}/> : <span>{initials(name || 'U')}</span>}<span className="avatar-camera"><Camera size={14}/></span></div><div><h2>Personal details</h2><p>Your name and photo are shown to people in your rooms.</p></div></div><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={60} placeholder="Your name"/></label><label>Profile photo URL <span className="optional">OPTIONAL · HTTPS</span><input type="url" value={avatar} onChange={(event) => setAvatar(event.target.value)} placeholder="https://example.com/photo.jpg"/></label><div className="profile-readonly"><Mail size={16}/><div><span>Email address</span><b>{user?.email}</b></div><BadgeCheck size={15}/></div>{error && <div className="error-banner">{error}</div>}{saved && <div className="success-banner">Profile saved. Your room display name is updated.</div>}<button className="button button-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>} Save changes</button></form><section className="profile-card security-card"><div className="profile-card-head"><div className="profile-security-icon"><Shield size={19}/></div><div><h2>Sign-in methods</h2><p>Manage how you access CineTogether.</p></div></div><div className="provider-row"><span className="provider-symbol"><KeyRound size={16}/></span><div><b>Email and password</b><small>{user?.authProviders?.password ? 'Password sign-in is enabled' : 'This account uses Google sign-in'}</small></div><span className={`provider-status ${user?.authProviders?.password ? 'enabled' : ''}`}>{user?.authProviders?.password ? 'ENABLED' : 'NOT SET'}</span></div><div className="provider-row"><span className="provider-symbol"><GoogleMark/></span><div><b>Google</b><small>{user?.authProviders?.google ? 'Your Google account is connected' : 'Google sign-in is not connected'}</small></div><span className={`provider-status ${user?.authProviders?.google ? 'enabled' : ''}`}>{user?.authProviders?.google ? 'CONNECTED' : 'NOT LINKED'}</span></div>{!user?.authProviders?.google && <a className="google-link-button" href={`${API}/api/auth/google`}><GoogleMark/> Connect Google account <ArrowRight size={15}/></a>}</section></main></div>;
}
function AuthPage({ signup = false, reset = false }: { signup?: boolean; reset?: boolean }) {
  const { setUser, user } = useAuth(); const nav = useNavigate(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [resetLink, setResetLink] = useState(''); const resetToken = new URLSearchParams(window.location.search).get('token');
  const oauthError = new URLSearchParams(window.location.search).get('error');
  useEffect(() => { if (oauthError === 'google_not_configured') setError('Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the API environment.'); else if (oauthError) setError(oauthError === 'google_email_unverified' ? 'Google must verify your email before you can continue.' : 'Google sign-in could not be completed. Please try again.'); }, [oauthError]);
  if (user) return <Navigate to="/app" replace />;
  const startGoogleLogin = async () => {
    setError(''); setBusy(true);
    try {
      const data = await request<{ url: string }>('/auth/google/url');
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Google sign-in.');
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setNotice(''); const form = new FormData(event.currentTarget); const name = String(form.get('name') || ''); const password = String(form.get('password') || '');
    if ((signup || (reset && resetToken)) && password !== form.get('password-confirm')) return setError('Those passwords don’t match.');
    setBusy(true);
    try {
      if (reset && resetToken) { const result = await post<{ message: string }>('/auth/reset-password', { token: resetToken, password }); setNotice(result.message); return; }
      if (reset) { const result = await post<{ message: string; resetUrl?: string }>('/auth/forgot-password', { email: form.get('email') }); setNotice(result.message); setResetLink(result.resetUrl || ''); return; }
      const data = await post<{ user: User }>(`/auth/${signup ? 'register' : 'login'}`, signup ? { name, email: form.get('email'), password } : { email: form.get('email'), password }); setUser(data.user); nav('/app');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not complete this request.'); } finally { setBusy(false); }
  };
  return <div className="auth-layout"><div className="auth-side"><Brand/><div className="auth-art"><div className="auth-glow"/><div className="auth-poster"><span>YOUR PRIVATE THEATER</span><div className="auth-poster-moon"/><b>THE<br/><i>GOOD</i><br/>PART</b><small>Every moment, better shared.</small></div><div className="auth-note"><Sparkles size={15}/> Made for movie people</div></div><div className="auth-side-bottom"><span>“It felt like we were all there.”</span><small>— every long-distance movie night</small></div></div><main className="auth-main"><div className="auth-mobile-brand"><Brand/></div><div className="auth-form-wrap"><Link to="/" className="back-link"><ArrowLeft size={15}/> Back to home</Link><span className="eyebrow">{reset ? 'ACCOUNT RECOVERY' : signup ? 'YOUR NEXT MOVIE NIGHT' : 'WELCOME BACK'}</span><h1>{reset ? 'Reset your password' : signup ? 'Create your account' : 'Good to see you.'}</h1><p className="auth-intro">{reset ? resetToken ? 'Choose a new password for your account.' : 'Enter the email associated with your account.' : signup ? 'Grab a seat. Your people are waiting.' : 'Your couch is ready. Let’s get the movie night going.'}</p>
{!reset && <button type="button" className="google-button" onClick={startGoogleLogin} disabled={busy}><GoogleMark/><span>Continue with Google</span></button>}
{!reset && <div className="auth-divider"><span>OR CONTINUE WITH EMAIL</span></div>}
<form onSubmit={submit} className="auth-form">
{signup && <label>Full name<input name="name" autoComplete="name" placeholder="How should we call you?" required minLength={2}/></label>}
{(!reset || !resetToken) && <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required/></label>}
{(!reset || resetToken) && <label>{reset ? 'New password' : 'Password'}<input name="password" type="password" autoComplete={signup || reset ? 'new-password' : 'current-password'} placeholder={signup || reset ? 'At least 8 characters' : 'Your password'} required minLength={signup || reset ? 8 : 1}/></label>}
{(signup || (reset && resetToken)) && <label>Confirm password<input name="password-confirm" type="password" placeholder="One more time" required minLength={8}/></label>}
{!signup && !reset && <div className="form-under"><span>Secure, private movie nights.</span><Link to="/forgot-password">Forgot password?</Link></div>}
{error && <div className="error-banner">{error}</div>}
{notice && <div className="success-banner">{notice}{resetLink && <> <a href={resetLink}>Open your password reset link</a><small className="dev-hint">Development mode: no email provider is configured.</small></>}</div>}
{!notice || (reset && resetToken) ? <button className="button button-primary button-wide" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : reset ? resetToken ? 'Update password' : 'Send reset instructions' : signup ? 'Create my account' : 'Log in'} <ArrowRight size={16}/></button> : null}</form>
<div className="auth-switch">{signup ? <>Already have an account? <Link to="/login">Log in</Link></> : <>New around here? <Link to="/register">Create an account</Link></>}</div>
<div className="secure-note"><LockKeyhole size={13}/> Your account stays yours. Always.</div></div>
<div className="auth-footer">By continuing, you agree to keep movie night kind and legal.</div></main></div>;
}
function Dashboard() {
  const { user, setUser } = useAuth(); const nav = useNavigate(); const [rooms, setRooms] = useState<Room[]>([]); const [createOpen, setCreateOpen] = useState(false); const [roomCode, setRoomCode] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [menu, setMenu] = useState(false);
  const refresh = () => request<{ rooms: Room[] }>('/rooms').then((d) => setRooms(d.rooms)).catch(() => {});
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!createOpen && !menu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (createOpen) setCreateOpen(false);
        else if (menu) setMenu(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createOpen, menu]);
  const logout = async () => { await post('/auth/logout'); setUser(null); nav('/'); };
  const join = async (e: FormEvent) => { e.preventDefault(); setError(''); setBusy(true); const code = roomCode.trim().toUpperCase(); try { await post(`/rooms/${encodeURIComponent(code)}/join`, {}); nav(`/room/${code}`); } catch (err) { const message = err instanceof Error ? err.message : 'Could not join room.'; if (message.toLowerCase().includes('password')) nav(`/room/${code}`); else setError(message); } finally { setBusy(false); } };
  const create = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(''); setBusy(true); const f = new FormData(e.currentTarget); try { const result = await post<{ room: Room }>('/rooms', { name: f.get('name'), description: f.get('description'), visibility: f.get('visibility'), password: f.get('password') || undefined, maxParticipants: Number(f.get('maxParticipants')) }); setCreateOpen(false); nav(`/room/${result.room.roomCode}`); } catch (err) { setError(err instanceof Error ? err.message : 'Could not create room.'); } finally { setBusy(false); } };
  return <div className="app-shell"><header className="app-header"><Brand small/><div className="dashboard-top-right"><Link className="history-nav-link" to="/history"><Clock3 size={15}/> History</Link><span className="online-label"><i className="live-dot"/> Your theater is ready</span><div className="profile-wrap"><button className="profile-button" onClick={() => setMenu(!menu)}><span className="avatar avatar-purple">{user?.avatar ? <img className="avatar-image" src={user.avatar} alt=""/> : initials(user?.name || 'U')}</span><span>{user?.name.split(' ')[0]}</span><ChevronDown size={14}/></button>{menu && <div className="profile-menu"><div className="profile-menu-name">{user?.name}<small>{user?.email}</small></div><Link to="/profile" onClick={() => setMenu(false)}><UserRound size={15}/> Your profile</Link><button onClick={logout}><LogOut size={15}/> Sign out</button></div>}</div></div></header><main className="dashboard-main"><section className="welcome-row"><div><span className="eyebrow">YOUR LITTLE CORNER OF THE INTERNET</span><h1>Welcome back, <span>{user?.name.split(' ')[0]}.</span></h1><p>Some stories are just better when you watch together.</p></div><div className="welcome-spark">✦<small>MAKE IT A MOVIE NIGHT</small></div></section><section className="dashboard-actions"><article className="create-card"><div className="card-orb"/><span className="action-icon"><Plus size={19}/></span><div><span className="eyebrow">YOUR THEATER, YOUR RULES</span><h2>Start a movie night</h2><p>Pick a room name. Invite your people. The rest is easy.</p></div><button className="button button-primary" onClick={() => { setError(''); setCreateOpen(true); }}>Create a room <ArrowRight size={16}/></button></article><article className="join-card"><div className="join-icon"><ArrowDownLeft size={18}/></div><div><h3>Joining friends?</h3><p>Enter the room code they sent you.</p></div><form onSubmit={join}><div className="join-input-wrap"><Film size={16}/><input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="CIN-7X92" maxLength={8} required/></div><button aria-label="Join room" disabled={busy}><ArrowRight size={17}/></button></form>{error && <span className="join-error">{error}</span>}</article></section><section className="recent-section"><div className="section-title"><div><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>Your recent rooms</h2></div><span className="room-count">{rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}</span></div>{rooms.length ? <div className="room-grid">{rooms.map((room) => <button className="recent-room" key={room._id} onClick={() => nav(`/room/${room.roomCode}`)}><div className="recent-poster"><div className="poster-stars">✦　·　✦</div><span>{room.currentMedia?.title || 'YOUR NEXT STORY'}</span><b>{room.name}</b><i className="recent-play"><Play size={15} fill="currentColor"/></i></div><div className="recent-meta"><div><b>{room.name}</b><small><i className="live-dot"/> {room.status === 'watching' ? 'Movie night in progress' : 'Waiting for your crew'}</small></div><span>{room.participants?.filter((p) => p.isActive).length || 0}<Users size={14}/></span></div></button>)}</div> : <div className="empty-rooms"><div className="empty-icon"><Film size={22}/></div><div><b>Your next favorite night starts here.</b><span>Create a room or join a friend — we’ll keep it right here.</span></div><button className="text-link" onClick={() => setCreateOpen(true)}>Start one <ArrowRight size={15}/></button></div>}</section>
      <section className="watched-section"><div className="section-title"><div><span className="eyebrow">BACK ON THE COUCH</span><h2>Recently watched</h2></div></div><div className="watched-list">{rooms.filter((room) => room.currentMedia?.title).slice(0, 3).map((room) => <button key={room._id} onClick={() => nav(`/room/${room.roomCode}`)}><span className="watched-film"><Film size={16}/></span><span><b>{room.currentMedia?.title}</b><small>{room.name}</small></span><ArrowRight size={15}/></button>)}</div></section>
      <section className="dashboard-tip"><Sparkles size={16}/><span><b>Little tip:</b> An authorized direct video link or shared upload keeps the whole group in sync.</span><span className="tip-decoration">✺</span></section></main>{createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setCreateOpen(false); }}><form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-room-heading" onSubmit={create}><div className="modal-heading"><div><span className="eyebrow">LET’S SET THE SCENE</span><h2 id="create-room-heading">Create your room</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setCreateOpen(false)}><X size={18}/></button></div>
<label>Room name<input name="name" placeholder="Friday night favorites" required minLength={2} maxLength={80}/></label>
<label>A little note <span className="optional">OPTIONAL</span><input name="description" placeholder="What are we watching tonight?" maxLength={240}/></label>
<div className="form-row">
<label>Visibility<select name="visibility"><option value="private">Private — invite only</option><option value="public">Public</option></select></label>
<label>Max guests<select name="maxParticipants" defaultValue="8"><option value="4">4 people</option><option value="8">8 people</option><option value="12">12 people</option><option value="20">20 people</option></select></label></div>
<label>Room password <span className="optional">OPTIONAL</span><input name="password" type="password" minLength={4} placeholder="Add an extra layer of privacy"/></label>
{error && <div className="error-banner">{error}</div>}
<button className="button button-primary button-wide" disabled={busy}>{busy ? 'Creating your room…' : 'Create room'} <ArrowRight size={16}/></button>
<p className="modal-footnote"><Shield size={13}/> You’re in control. Only invited guests can join a private room.</p></form></div>}</div>;
}
function HistoryPage() {
  const [tab, setTab] = useState<'joined' | 'created'>('joined');
  const [joinedRooms, setJoinedRooms] = useState<JoinedRoomHistory[]>([]);
  const [createdRooms, setCreatedRooms] = useState<CreatedRoomHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRoom, setExpandedRoom] = useState('');
  useEffect(() => {
    request<{ joinedRooms: JoinedRoomHistory[]; createdRooms: CreatedRoomHistory[] }>('/history')
      .then((data) => { setJoinedRooms(data.joinedRooms); setCreatedRooms(data.createdRooms); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your history.'))
      .finally(() => setLoading(false));
  }, []);
  const timestamp = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const sessionLength = (visit: HistoryVisit & { isActive?: boolean }) => {
    if (!visit.leftAt) return visit.isActive ? 'In this room now' : 'End time unavailable';
    const minutes = Math.max(0, Math.round((new Date(visit.leftAt).getTime() - new Date(visit.joinedAt).getTime()) / 60_000));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
  };
  const renderDetails = (details: HistoryDetails, roomCode: string, status: string, visits?: HistoryVisit[]) => <div className="history-details">
    {visits && <section className="history-detail-section"><h3>Your visits</h3><div className="history-visit-list">{visits.map((visit, index) => <div className="history-visit-row" key={`${visit.joinedAt}-${index}`}><span><b>Joined</b>{timestamp(visit.joinedAt)}</span><span><b>Left</b>{visit.leftAt ? timestamp(visit.leftAt) : 'Not recorded'}</span><span><b>Duration</b>{sessionLength(visit)}</span></div>)}</div></section>}
    <section className="history-detail-section"><h3>Movies watched <span>{details.movieHistory.length}</span></h3>{details.movieHistory.length ? <div className="history-movie-list">{details.movieHistory.map((movie, index) => <div className="history-movie-row" key={`${movie.selectedAt}-${index}`}><span className="history-movie-icon"><Film size={15}/></span><span><b>{movie.title}</b><small>{timestamp(movie.selectedAt)}{movie.mimeType ? ` · ${movie.mimeType}` : ''}</small></span></div>)}</div> : <p className="history-detail-empty">No movie selections were recorded for this room.</p>}</section>
    <section className="history-detail-section"><h3>People and visit times <span>{details.participants.length}</span></h3>{details.participants.length ? <div className="history-people-list">{details.participants.map((participant, personIndex) => <article className="history-person-row" key={`${participant.name}-${personIndex}`}><div className="history-person-heading"><b>{participant.name}</b><span>{participant.role === 'ADMIN' ? 'Admin' : 'Guest'}{participant.isActive ? ' · In room' : ''}</span></div>{participant.sessions.map((visit, index) => <div className="history-visit-row" key={`${visit.joinedAt}-${index}`}><span><b>Joined</b>{timestamp(visit.joinedAt)}</span><span><b>Left</b>{visit.leftAt ? timestamp(visit.leftAt) : participant.isActive ? 'Still in room' : 'Not recorded'}</span><span><b>Duration</b>{sessionLength({ ...visit, isActive: participant.isActive })}</span></div>)}</article>)}</div> : <p className="history-detail-empty">No participant details are available.</p>}</section>
    <section className="history-detail-section"><h3>Message history <span>{details.messages.length}</span></h3>{details.messages.length ? <div className="history-message-list">{details.messages.map((message) => <article className={`history-message-row ${message.messageType === 'system' ? 'history-system-row' : ''}`} key={message._id}><span>{message.senderName}</span><p>{message.message}</p><time>{timestamp(message.createdAt)}</time></article>)}</div> : <p className="history-detail-empty">No messages were recorded for this room.</p>}</section>
    {status !== 'closed' && <Link className="button button-soft history-return-link" to={`/room/${roomCode}`}>Open this room <ArrowRight size={15}/></Link>}
  </div>;
  const toggleRoom = (id: string) => setExpandedRoom((current) => current === id ? '' : id);
  return <div className="history-page">
    <header className="app-header history-header"><Brand small/><Link className="history-nav-link" to="/app"><ArrowLeft size={15}/> Dashboard</Link></header>
    <main className="history-main">
      <div className="history-heading"><span className="eyebrow">YOUR CINE TOGETHER STORY</span><h1>Room history</h1><p>Movie nights you joined and rooms you created, with their dates and details.</p></div>
      <div className="history-tabs" role="tablist" aria-label="Room history">
        <button type="button" role="tab" aria-selected={tab === 'joined'} className={tab === 'joined' ? 'selected' : ''} onClick={() => { setTab('joined'); setExpandedRoom(''); }}>Joined rooms <span>{joinedRooms.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'created'} className={tab === 'created' ? 'selected' : ''} onClick={() => { setTab('created'); setExpandedRoom(''); }}>Created rooms <span>{createdRooms.length}</span></button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {loading ? <div className="history-empty">Loading your room history…</div> : tab === 'joined'
        ? joinedRooms.length ? <div className="history-list">{joinedRooms.map((room) => <article className={`history-card ${expandedRoom === room.roomId ? 'expanded' : ''}`} key={room.roomId}>
          <div className="history-card-icon"><Users size={19}/></div>
          <div className="history-card-content"><div className="history-card-heading"><div><h2>{room.roomName}</h2><span className="history-room-code">{room.roomCode}</span></div><span className={`history-status ${room.roomStatus === 'closed' ? 'closed' : room.isActive ? 'active' : ''}`}>{room.roomStatus === 'closed' ? 'Closed' : room.isActive ? 'In room' : 'Ended'}</span></div>
            {room.currentMedia?.title && <p className="history-movie"><Film size={14}/>{room.currentMedia.title}</p>}
            <div className="history-times"><span><b>First joined</b>{timestamp(room.joinedAt)}</span><span><b>Last left</b>{room.leftAt ? timestamp(room.leftAt) : room.isActive ? 'Still in room' : 'Not recorded'}</span><span><b>Visits</b>{room.visits.length}</span></div>
            {expandedRoom === room.roomId && renderDetails(room, room.roomCode, room.roomStatus, room.visits)}
          </div>
          <button className={`history-open ${expandedRoom === room.roomId ? 'expanded' : ''}`} type="button" onClick={() => toggleRoom(room.roomId)} aria-label={`${expandedRoom === room.roomId ? 'Hide' : 'Show'} details for ${room.roomName}`} aria-expanded={expandedRoom === room.roomId}><ChevronDown size={17}/></button>
        </article>)}</div> : <div className="history-empty"><Users size={22}/><b>No joined rooms yet</b><span>Rooms you join will appear here with each visit’s start and end time.</span></div>
        : createdRooms.length ? <div className="history-list">{createdRooms.map((room) => <article className={`history-card ${expandedRoom === room._id ? 'expanded' : ''}`} key={room._id}>
          <div className="history-card-icon"><Clapperboard size={19}/></div>
          <div className="history-card-content"><div className="history-card-heading"><div><h2>{room.name}</h2><span className="history-room-code">{room.roomCode}</span></div><span className={`history-status ${room.status === 'closed' ? 'closed' : 'active'}`}>{room.status === 'closed' ? 'Closed' : room.status === 'watching' ? 'Watching' : 'Waiting'}</span></div>
            {room.description && <p className="history-description">{room.description}</p>}
            {room.currentMedia?.title && <p className="history-movie"><Film size={14}/>{room.currentMedia.title}</p>}
            <div className="history-times"><span><b>Created</b>{timestamp(room.createdAt)}</span><span><b>People</b>{room.participants.length}</span></div>
            {expandedRoom === room._id && renderDetails(room, room.roomCode, room.status)}
          </div>
          <button className={`history-open ${expandedRoom === room._id ? 'expanded' : ''}`} type="button" onClick={() => toggleRoom(room._id)} aria-label={`${expandedRoom === room._id ? 'Hide' : 'Show'} details for ${room.name}`} aria-expanded={expandedRoom === room._id}><ChevronDown size={17}/></button>
        </article>)}</div> : <div className="history-empty"><Clapperboard size={22}/><b>No created rooms yet</b><span>Rooms you create will appear here.</span><Link className="button button-primary" to="/app">Create a room <ArrowRight size={15}/></Link></div>}
    </main>
  </div>;
}

function RoomPage() {
  const { code = '' } = useParams(); const nav = useNavigate(); const { user } = useAuth(); const [room, setRoom] = useState<Room | null>(null); const [messages, setMessages] = useState<Message[]>([]); const [connected, setConnected] = useState(false); const [error, setError] = useState(''); const [tab, setTab] = useState<'chat' | 'people'>('chat'); const [password, setPassword] = useState(''); const [needsPassword, setNeedsPassword] = useState(false); const [transfer, setTransfer] = useState<Participant | null>(null); const [movieOpen, setMovieOpen] = useState(false); const [movieError, setMovieError] = useState(''); const [reactions, setReactions] = useState<{ id: string; emoji: string; name: string }[]>([]); const socketRef = useRef<Socket | null>(null);
  const [playback, setPlayback] = useState<Playback>({ position: 0, playing: false, updatedAt: Date.now() }); const [online, setOnline] = useState<Record<string, boolean>>({});
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false); const [settingsError, setSettingsError] = useState(''); const [settingsBusy, setSettingsBusy] = useState(false); const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  type UploadState = { uploading: boolean; percent: number; fileName: string; loaded: number; total: number; };
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const isAdmin = room?.ownerId === user?.id;
  useEffect(() => { if (movieOpen) request<{ media: MediaItem[] }>('/media').then((result) => setLibrary(result.media)).catch(() => setLibrary([])); }, [movieOpen]);
  useEffect(() => { let mounted = true; post<{ room: Room }>(`/rooms/${code}/join`, {}).then(({ room: joined }) => { if (mounted) { setRoom(joined); setNeedsPassword(false); } }).catch((err) => { if (mounted) { const text = err instanceof Error ? err.message : ''; if (text.toLowerCase().includes('password')) setNeedsPassword(true); else setError(text); } }); return () => { mounted = false; socketRef.current?.disconnect(); }; }, [code]);
  useEffect(() => { const openPicker = () => { setMovieError(''); setMovieOpen(true); }; document.addEventListener('open-movie-picker', openPicker); return () => document.removeEventListener('open-movie-picker', openPicker); }, []);
  useEffect(() => {
    if (!room) return;
    const socket = io(import.meta.env.VITE_SOCKET_URL || API || window.location.origin, { withCredentials: true, autoConnect: true, transports: ['websocket'] }); socketRef.current = socket;
    socket.on('connect', () => { setConnected(true); socket.emit('room:join', { roomCode: code }); }); socket.on('disconnect', () => setConnected(false));
    socket.on('room:state', (data: { room: Room; playback?: Playback }) => { setRoom(data.room); if (data.playback) setPlayback(data.playback); });
    socket.on('participants:update', (participants: Participant[]) => setRoom((prev) => prev ? { ...prev, participants } : prev));
    socket.on('chat:history', (history: Message[]) => setMessages(history)); socket.on('chat:message', (message: Message) => setMessages((prev) => [...prev.slice(-99), message]));
    socket.on('playback:sync', (state: Playback) => setPlayback(state)); socket.on('playback:movie-change', (data: { media: Room['currentMedia'] }) => { if (data.media) setRoom((prev) => prev ? { ...prev, currentMedia: data.media } : prev); setPlayback({ position: 0, playing: false, updatedAt: Date.now() }); });
    socket.on('playback:ended', () => setPlayback({ position: 0, playing: false, updatedAt: Date.now() }));
    socket.on('presence:update', ({ userId, online }: { userId: string; online: boolean }) => setOnline((prev) => ({ ...prev, [userId]: online })));
    socket.on('reaction:received', ({ id, emoji, name }: { id: string; emoji: string; name: string }) => {
      setReactions((current) => [...current.slice(-5), { id, emoji, name }]);
      window.setTimeout(() => setReactions((current) => current.filter((reaction) => reaction.id !== id)), 2600);
    });
    socket.on('room:closed', () => { setError('This movie room has closed.'); window.setTimeout(() => nav('/app'), 1500); }); socket.on('room:left', () => nav('/app')); socket.on('room:removed', () => nav('/app')); socket.on('room:error', (data: { message: string }) => setError(data.message));
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [room?._id, code]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (closeConfirmOpen) { setCloseConfirmOpen(false); return; }
      if (transfer) { setTransfer(null); return; }
      if (settingsOpen) { setSettingsOpen(false); return; }
      if (movieOpen) { if (uploadState) cancelUpload(); setMovieOpen(false); return; }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeConfirmOpen, transfer, settingsOpen, movieOpen, uploadState]);
  const joinWithPassword = async (e: FormEvent) => { e.preventDefault(); try { const data = await post<{ room: Room }>(`/rooms/${code}/join`, { password }); setRoom(data.room); setNeedsPassword(false); setError(''); } catch (err) { setError(err instanceof Error ? err.message : 'Could not join.'); } };
  if (needsPassword) return <div className="password-screen"><Brand/><form className="password-card" onSubmit={joinWithPassword}><div className="lock-large"><LockKeyhole/></div><span className="eyebrow">PRIVATE MOVIE NIGHT</span><h1>One more thing.</h1><p>This room is password protected. Ask your friend for the secret knock.</p><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Room password" autoFocus required/>{error && <div className="error-banner">{error}</div>}<button className="button button-primary button-wide">Join the room <ArrowRight size={16}/></button><Link className="back-link" to="/app"><ArrowLeft size={15}/> Back to dashboard</Link></form></div>;
  if (error && !room) return <div className="password-screen"><Brand/><div className="password-card"><div className="lock-large"><Film/></div><h1>Can’t get in.</h1><p>{error}</p><Link to="/app" className="button button-primary button-wide">Back to dashboard</Link></div></div>;
  if (!room) return <div className="screen-loading"><LoaderCircle className="spin"/> Preparing your room…</div>;
  const active = room.participants.filter((p) => p.isActive); const emit = (event: string, payload?: unknown) => socketRef.current?.emit(event, payload);
  const leave = async () => { try { await post(`/rooms/${code}/leave`); } finally { socketRef.current?.disconnect(); nav('/app'); } };
  const closeRoom = async () => { try { await request(`/rooms/${code}`, { method: 'DELETE' }); nav('/app'); } catch (err) { setError(err instanceof Error ? err.message : 'Could not close room.'); setCloseConfirmOpen(false); } };
  const saveSettings = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSettingsError('');
    setSettingsBusy(true);
    const f = new FormData(e.currentTarget);
    const name = String(f.get('name') || '').trim();
    const description = String(f.get('description') || '').trim();
    const visibility = f.get('visibility') as 'private' | 'public';
    const maxParticipants = Number(f.get('maxParticipants'));
    const password = String(f.get('password') || '').trim();
    try {
      const payload: { name: string; description?: string; visibility: 'private' | 'public'; maxParticipants: number; password?: string } = {
        name,
        description: description || undefined,
        visibility,
        maxParticipants,
        ...(password ? { password } : {})
      };
      const data = await updateRoomSettings(code, payload);
      setRoom(data.room);
      setSettingsOpen(false);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Could not update room settings.');
    } finally {
      setSettingsBusy(false);
    }
  };
  const cancelUpload = () => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    setUploadState(null);
    setMovieError('Upload cancelled.');
  };

  const transferAdmin = async () => { if (!transfer) return; try { const data = await post<{ room: Room }>(`/rooms/${code}/transfer-admin`, { userId: uid(transfer) }); setRoom(data.room); setTransfer(null); } catch (err) { setError(err instanceof Error ? err.message : 'Could not transfer admin.'); } };
  const remove = async (p: Participant) => { const name = p.name || (typeof p.userId === 'object' ? p.userId.name : '') || 'this participant'; if (!window.confirm(`Remove ${name} from the room?`)) return; try { const data = await post<{ room: Room }>(`/rooms/${code}/remove-participant`, { userId: uid(p) }); setRoom(data.room); } catch (err) { setError(err instanceof Error ? err.message : 'Could not remove participant.'); } };
  const saveMovie = async (title: string, url: string) => { setMovieError(''); try { const data = await post<{ room: Room }>(`/rooms/${code}/media`, { title, url }); setRoom(data.room); setMovieOpen(false); } catch (err) { setMovieError(err instanceof Error ? err.message : 'Could not select video.'); } };
  const selectLibraryMovie = async (mediaId: string) => { setMovieError(''); try { const data = await post<{ room: Room }>(`/rooms/${code}/media`, { mediaId }); setRoom(data.room); setMovieOpen(false); } catch (err) { setMovieError(err instanceof Error ? err.message : 'Could not select video.'); } };
  const uploadMovie = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) return setMovieError('Choose a video file.');
    setMovieError('');
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploadState({
      uploading: true,
      percent: 0,
      fileName: file.name,
      loaded: 0,
      total: file.size,
    });
    const form = new FormData();
    form.append('video', file);
    form.append('title', file.name.replace(/\.[^.]+$/, ''));
    try {
      const result = await uploadWithProgress<{ media: { title: string; url: string } }>(
        '/media/upload',
        form,
        (percent, loaded, total) => {
          setUploadState({
            uploading: true,
            percent,
            fileName: file.name,
            loaded,
            total,
          });
        },
        controller.signal
      );
      await saveMovie(result.media.title, result.media.url);
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        setMovieError(err instanceof Error ? err.message : 'Upload failed.');
      }
    } finally {
      setUploadState(null);
      uploadAbortRef.current = null;
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  return <div className="room-shell"><header className="room-header"><Link to="/app" className="room-back"><ArrowLeft size={16}/><span>Dashboard</span></Link><div className="room-name-block"><span className="room-film-icon"><Clapperboard size={16}/></span><div><b>{room.name}</b><span><i className="live-dot"/> {room.status === 'watching' ? 'Movie night in progress' : 'Waiting for the crew'}</span></div></div><div className="room-header-actions"><span className={`connection-pill ${connected ? 'connected' : ''}`}><i/> {connected ? 'Connected' : 'Reconnecting'}</span><button className="room-code-button" onClick={() => navigator.clipboard.writeText(room.roomCode)}><span>{room.roomCode}</span><Copy size={14}/></button><button className="button button-primary button-sm" onClick={async () => { const url = `${location.origin}/room/${room.roomCode}`; try { if (navigator.share) await navigator.share({ title: room.name, url }); else { await navigator.clipboard.writeText(url); alert('Invite link copied!'); } } catch { /* Share dialog dismissed. */ } }}><Users size={15}/> Invite</button></div></header>
    <main className="room-layout"><section className="theater-column"><div className="theater-toolbar"><div><span className="eyebrow">NOW SHOWING</span><h1>{room.currentMedia?.title || 'Your movie night starts here'}</h1></div>{isAdmin && <button className="button button-soft" onClick={() => { setMovieError(''); setMovieOpen(true); }}><Film size={15}/>{room.currentMedia ? 'Change movie' : 'Choose a movie'}</button>}</div><VideoPlayer media={room.currentMedia} playback={playback} isAdmin={!!isAdmin} reactions={reactions} emit={emit}/><div className="theater-under"><div className="watching-faces">{active.slice(0, 4).map((p, i) => <span className={`avatar ${i % 2 ? 'avatar-pink' : 'avatar-purple'}`} key={uid(p)}>{initials(p.name || (typeof p.userId === 'object' ? p.userId.name || 'G' : 'G'))}</span>)}<span className="watching-copy"><b>{active.length} {active.length === 1 ? 'person' : 'people'}</b> in the room</span></div><div className="room-safety"><Shield size={14}/> Private room</div></div><div className="room-mobile-tabs"><button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}><MessageCircle size={16}/> Chat <span>{messages.filter((m) => m.messageType !== 'system').length}</span></button><button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}><Users size={16}/> People <span>{active.length}</span></button></div></section>
      <aside className={`room-sidebar ${tab === 'people' ? 'show-people' : ''}`}><div className="sidebar-tabs"><button className={tab === 'chat' ? 'selected' : ''} onClick={() => setTab('chat')}><MessageCircle size={15}/> Chat <span>{messages.filter((m) => m.messageType !== 'system').length}</span></button><button className={tab === 'people' ? 'selected' : ''} onClick={() => setTab('people')}><Users size={15}/> People <span>{active.length}</span></button></div>{tab === 'chat' ? <ChatPanel messages={messages} emit={emit} user={user}/>: <PeoplePanel participants={active} currentUser={user} isAdmin={!!isAdmin} online={online} onTransfer={setTransfer} onRemove={remove}/>}<div className="sidebar-footer">{isAdmin ? <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '8px' }}><button type="button" onClick={() => { setSettingsError(''); setSettingsOpen(true); }} style={{ color: '#c4b5fd' }}><Settings2 size={14}/> Room settings</button><button type="button" onClick={() => setCloseConfirmOpen(true)} style={{ color: '#fda4af' }}><LogOut size={14}/> Close room</button></div> : <button onClick={leave}><LogOut size={14}/> Leave movie night</button>}</div></aside></main>
    {error && room && <div className="toast-error" onClick={() => setError('')}>{error}<X size={14}/></div>}
    {transfer && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setTransfer(null); }}><div className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="transfer-admin-heading"><div className="confirm-icon"><Crown size={21}/></div><button className="icon-button modal-close" aria-label="Close dialog" onClick={() => setTransfer(null)}><X size={17}/></button><span className="eyebrow">PASS THE POPCORN</span><h2 id="transfer-admin-heading">Transfer admin?</h2><p>{user?.name} will hand room controls to <b>{transfer.name || 'this participant'}</b>. You’ll stay in the room as a guest.</p><div className="confirm-actions"><button className="button button-soft" onClick={() => setTransfer(null)}>Keep control</button><button className="button button-primary" onClick={transferAdmin}>Transfer rights <ArrowRight size={15}/></button></div></div></div>}
    {movieOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) { if (uploadState) cancelUpload(); setMovieOpen(false); } }}><div className="modal-card media-modal" role="dialog" aria-modal="true" aria-labelledby="choose-movie-heading"><div className="modal-heading"><div><span className="eyebrow">SET THE SCENE</span><h2 id="choose-movie-heading">Choose a movie</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => { if (uploadState) cancelUpload(); setMovieOpen(false); }}><X size={18}/></button></div>
      {library.length > 0 && <div className="library-list"><span className="eyebrow">YOUR VIDEO LIBRARY</span>{library.map((item) => <button className="library-item" type="button" key={item._id} disabled={!!uploadState} onClick={() => void selectLibraryMovie(item._id)}><Film size={17}/><span className="library-item-content"><b>{item.title}</b>{item.description && <small className="library-description">{item.description}</small>}<span className="library-item-details"><small>{item.sourceType === 'upload' ? 'Uploaded video' : youtubeIdFromUrl(item.sourceUrl) ? 'YouTube video' : 'Video link'}{item.mimeType ? ` · ${item.mimeType}` : ''}</small>{typeof item.duration === 'number' && item.duration > 0 && <small>{Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, '0')}</small>}{item.createdAt && <small>Added {new Date(item.createdAt).toLocaleDateString()}</small>}</span></span><span className="library-select-label">Select <ArrowRight size={14}/></span></button>)}</div>}
      <div className="media-choice">
        <div className="media-choice-icon"><Film/></div>
        <div><b>Direct video file or YouTube</b><span>Paste a direct MP4/WebM/OGG link or an embeddable YouTube video URL. Netflix and other streaming pages aren’t supported.</span></div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void saveMovie(String(f.get('title')), String(f.get('url'))); }}>
        <label>Movie title<input name="title" placeholder="A film for tonight" required maxLength={100} disabled={!!uploadState}/></label>
        <label>Video URL<input name="url" type="url" placeholder="https://youtube.com/watch?v=… or https://media.example.com/movie.mp4" required disabled={!!uploadState}/></label>
        <button className="button button-primary button-wide" disabled={!!uploadState}>Set movie for everyone <ArrowRight size={16}/></button>
      </form>
      <div className="upload-divider"><span>OR UPLOAD A VIDEO FILE</span></div>
      {uploadState ? (
        <div className="upload-progress-card" role="status" aria-live="polite">
          <div className="upload-progress-head">
            <div className="upload-progress-title">
              <LoaderCircle className="spin" size={18}/>
              <div>
                <b>Uploading {uploadState.fileName}</b>
                <small>{uploadState.percent < 100 ? `${uploadState.percent}% uploaded` : 'Processing video on server…'}</small>
              </div>
            </div>
            <button type="button" className="button button-soft button-sm upload-cancel-btn" onClick={cancelUpload}>Cancel</button>
          </div>
          <div className="upload-progress-track" role="progressbar" aria-valuenow={uploadState.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
            <div className="upload-progress-fill" style={{ width: `${Math.max(4, uploadState.percent)}%` }} />
          </div>
          <div className="upload-progress-meta">
            <span>{formatBytes(uploadState.loaded)} of {formatBytes(uploadState.total)}</span>
            <span>{uploadState.percent}%</span>
          </div>
        </div>
      ) : (
        <label className="upload-drop"><input type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime" onChange={(e) => void uploadMovie(e.target.files?.[0])}/><span className="upload-icon"><Plus size={18}/></span><b>Choose an authorized video file</b><small>MP4, WebM, OGG or MOV · up to 1 GB</small></label>
      )}
      <div className="notice"><Shield size={14}/><span>Only share videos you have permission to watch and share. Local uploads are stored by this server and must remain online for guests.</span></div>
      {movieError && <div className="error-banner">{movieError}</div>}
    </div></div>}
    {settingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
      <form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="settings-heading" onSubmit={saveSettings}>
        <div className="modal-heading">
          <div><span className="eyebrow">THEATER CONTROLS</span><h2 id="settings-heading">Room settings</h2></div>
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setSettingsOpen(false)}><X size={18}/></button>
        </div>
        <label>Room name<input name="name" defaultValue={room.name} required minLength={2} maxLength={80}/></label>
        <label>A little note <span className="optional">OPTIONAL</span><input name="description" defaultValue={room.description || ''} maxLength={240} placeholder="What are we watching tonight?"/></label>
        <div className="form-row">
          <label>Visibility<select name="visibility" defaultValue={room.visibility || 'private'}><option value="private">Private — invite only</option><option value="public">Public</option></select></label>
          <label>Max guests<select name="maxParticipants" defaultValue={String(room.maxParticipants || 8)}><option value="4">4 people</option><option value="8">8 people</option><option value="12">12 people</option><option value="20">20 people</option></select></label>
        </div>
        <label>Room password <span className="optional">LEAVE BLANK TO KEEP UNCHANGED</span><input name="password" type="password" minLength={4} placeholder="Update or remove password"/></label>
        {settingsError && <div className="error-banner">{settingsError}</div>}
        <div className="confirm-actions" style={{ marginTop: '16px' }}>
          <button type="button" className="button button-soft" onClick={() => setSettingsOpen(false)}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={settingsBusy}>{settingsBusy ? 'Saving…' : 'Save settings'} <ArrowRight size={15}/></button>
        </div>
        <p className="modal-footnote"><Shield size={13}/> Changes will apply immediately to everyone in the room.</p>
      </form>
    </div>}
    {closeConfirmOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setCloseConfirmOpen(false); }}>
      <div className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="close-room-heading">
        <div className="confirm-icon" style={{ background: '#ef44441f', color: '#f87171' }}><LogOut size={21}/></div>
        <button className="icon-button modal-close" aria-label="Close dialog" onClick={() => setCloseConfirmOpen(false)}><X size={17}/></button>
        <span className="eyebrow" style={{ color: '#f87171' }}>CLOSING TIME</span>
        <h2 id="close-room-heading">Close movie night?</h2>
        <p>Are you sure you want to close <b>{room.name}</b>? This will end the session for everyone and close the room. This cannot be undone.</p>
        <div className="confirm-actions">
          <button className="button button-soft" onClick={() => setCloseConfirmOpen(false)}>Keep room open</button>
          <button className="button button-primary" style={{ background: '#ef4444', borderColor: '#ef4444' }} onClick={closeRoom}>Close room <ArrowRight size={15}/></button>
        </div>
      </div>
    </div>}
  </div>;
}
type Playback = { position: number; playing: boolean; updatedAt: number; changedBy?: string };
function VideoPlayer({ media, playback, isAdmin, reactions, emit }: { media?: Room['currentMedia']; playback: Playback; isAdmin: boolean; reactions: { id: string; emoji: string; name: string }[]; emit: (event: string, payload?: unknown) => void }) {
  const frameRef = useRef<HTMLDivElement>(null); const videoRef = useRef<HTMLVideoElement>(null); const youtubeContainerRef = useRef<HTMLDivElement>(null); const youtubeRef = useRef<YouTubePlayerInstance | null>(null); const emitRef = useRef(emit); const adminRef = useRef(isAdmin);
  const [time, setTime] = useState(0); const [duration, setDuration] = useState(0); const [volume, setVolume] = useState(0.8); const [muted, setMuted] = useState(false); const [speed, setSpeed] = useState(1); const [mediaError, setMediaError] = useState(false); const [youtubeReady, setYoutubeReady] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const youtubeId = media?.url ? youtubeIdFromUrl(media.url) : null; const expectedPosition = playback.position + (playback.playing ? Math.max(0, (Date.now() - playback.updatedAt) / 1000) : 0);
  useEffect(() => { emitRef.current = emit; adminRef.current = isAdmin; }, [emit, isAdmin]);
  useEffect(() => {
    setTime(0); setDuration(0); setMediaError(false); setYoutubeReady(false); setScrubTime(null);
    if (!media?.url || youtubeId) return;
    videoRef.current?.load();
  }, [media?.url, youtubeId]);
  useEffect(() => {
    if (!youtubeId || !youtubeContainerRef.current) return;
    let cancelled = false;
    const target = document.createElement('div');
    youtubeContainerRef.current.appendChild(target);
    void loadYouTubeApi().then(() => {
      if (cancelled || !youtubeContainerRef.current || !window.YT) return;
      youtubeRef.current = new window.YT.Player(target, {
        videoId: youtubeId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: ({ target: player }) => { if (cancelled) return; youtubeRef.current = player; player.setVolume(Math.round(volume * 100)); if (muted) player.mute(); setDuration(player.getDuration() || 0); setYoutubeReady(true); },
          onStateChange: ({ data, target: player }) => { if (cancelled) return; if (window.YT?.PlayerState && data === window.YT.PlayerState.ENDED && adminRef.current) emitRef.current('playback:ended'); if (data === window.YT?.PlayerState.PLAYING) setTime(player.getCurrentTime()); },
          onError: () => setMediaError(true)
        }
      });
    }).catch(() => setMediaError(true));
    return () => { cancelled = true; youtubeRef.current?.destroy(); youtubeRef.current = null; youtubeContainerRef.current?.replaceChildren(); };
  }, [youtubeId]);
  useEffect(() => {
    if (!youtubeReady || !youtubeRef.current) return;
    const player = youtubeRef.current;
    const timer = window.setInterval(() => { if (scrubTime === null) setTime(player.getCurrentTime() || 0); const length = player.getDuration() || 0; if (length) setDuration(length); }, 400);
    return () => window.clearInterval(timer);
  }, [youtubeReady, youtubeId, scrubTime]);
  useEffect(() => {
    const expected = Math.max(0, expectedPosition);
    if (youtubeId) {
      const player = youtubeRef.current;
      if (!youtubeReady || !player) return;
      if (Math.abs((player.getCurrentTime() || 0) - expected) > 1.25) player.seekTo(expected, true);
      if (playback.playing) player.playVideo(); else player.pauseVideo();
      return;
    }
    const video = videoRef.current;
    if (!video || !media?.url) return;
    if (Math.abs(video.currentTime - expected) > 1.25) video.currentTime = expected;
    if (playback.playing && video.paused) void video.play().catch(() => {}); else if (!playback.playing && !video.paused) video.pause();
  }, [playback.position, playback.playing, playback.updatedAt, media?.url, youtubeId, youtubeReady]);
  useEffect(() => {
    if (!playback.playing || !media?.url) return;
    const interval = window.setInterval(() => {
      if (scrubTime !== null) return;
      const currentExpected = Math.max(0, playback.position + (playback.playing ? Math.max(0, (Date.now() - playback.updatedAt) / 1000) : 0));
      if (youtubeId) {
        const player = youtubeRef.current;
        if (!youtubeReady || !player) return;
        const current = player.getCurrentTime() || 0;
        if (Math.abs(current - currentExpected) > 1.25) player.seekTo(currentExpected, true);
      } else {
        const video = videoRef.current;
        if (!video) return;
        if (Math.abs(video.currentTime - currentExpected) > 1.25) video.currentTime = currentExpected;
      }
    }, 500);
    return () => window.clearInterval(interval);
  }, [playback.playing, playback.position, playback.updatedAt, media?.url, youtubeId, youtubeReady, scrubTime]);
  const fmt = (seconds: number) => { const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0; return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${Math.floor(safe % 60).toString().padStart(2, '0')}`; };
  const seek = (value: number) => { setTime(value); if (youtubeId) youtubeRef.current?.seekTo(value, true); else if (videoRef.current) videoRef.current.currentTime = value; };
  const commitSeek = (targetValue: number) => {
    const target = Math.max(0, Math.min(targetValue, duration || 24 * 60 * 60));
    setScrubTime(null);
    setTime(target);
    seek(target);
    emit('playback:seek', { position: target });
  };
  const changeVolume = (value: number) => { setVolume(value); setMuted(value === 0); if (youtubeId) { youtubeRef.current?.setVolume(Math.round(value * 100)); if (value > 0) youtubeRef.current?.unMute(); else youtubeRef.current?.mute(); } else if (videoRef.current) { videoRef.current.volume = value; videoRef.current.muted = value === 0; } };
  const toggleMute = () => { const next = !muted; setMuted(next); if (youtubeId) { if (next) youtubeRef.current?.mute(); else { youtubeRef.current?.unMute(); youtubeRef.current?.setVolume(Math.round(volume * 100)); } } else if (videoRef.current) videoRef.current.muted = next; };
  const changeSpeed = (value: number) => { setSpeed(value); if (youtubeId) youtubeRef.current?.setPlaybackRate(value); else if (videoRef.current) videoRef.current.playbackRate = value; };
  const playFromOverlay = () => {
    if (!isAdmin) return;
    emit('playback:play', { position: time });
  };
  const toggleFullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void frameRef.current?.requestFullscreen(); };
  return <div className="video-frame" ref={frameRef}><div className={`video-screen ${mediaError ? 'video-failed' : ''} ${youtubeId ? 'video-youtube' : ''}`}>
    {media?.url ? <>
      {youtubeId ? <div className="youtube-player-mount" ref={youtubeContainerRef}/> : <video ref={videoRef} src={media.url} playsInline preload="metadata" onTimeUpdate={(event) => { if (scrubTime === null) setTime(event.currentTarget.currentTime); }} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)} onError={() => setMediaError(true)} onEnded={() => emit('playback:ended')}/>}
      {!mediaError && !playback.playing && time < 0.5 && <div className="video-overlay"><span className="overlay-caption">{isAdmin ? 'THE THEATER IS ALL YOURS' : 'PLAYBACK CONTROLLED BY ROOM ADMIN'}</span><h2>Settle in.<br/><i>The good part’s coming.</i></h2><button className="overlay-play" disabled={!isAdmin} onClick={playFromOverlay} aria-label={isAdmin ? 'Start synchronized playback' : 'Waiting for the room admin to start playback'} title={isAdmin ? 'Start playback for everyone' : 'Only the room admin can start playback'}><Play fill="currentColor" size={19}/></button><span className="overlay-caption">{isAdmin ? 'START FOR EVERYONE' : 'WAITING FOR ROOM ADMIN'}</span></div>}
      {playback.playing && <div className="video-live"><i className="live-dot"/> WATCHING TOGETHER</div>}
      {mediaError && <div className="video-error-overlay"><b>Video could not be loaded</b><span>{youtubeId ? 'This video may not allow embedding, may be private, or may be unavailable in your region.' : 'Check that this direct video file is reachable and shared with the room.'}</span></div>}
    </> : <div className="video-empty"><div className="empty-film"><Clapperboard size={26}/></div><span className="eyebrow">YOUR MOVIE NIGHT, YOUR MOVIE</span><h2>Every great night<br/>starts with a story.</h2><p>{isAdmin ? 'Choose a shared video to get the popcorn rolling.' : 'Your host will choose a movie in just a moment.'}</p>{isAdmin && <button className="button button-primary" onClick={() => document.dispatchEvent(new CustomEvent('open-movie-picker'))}>Choose a movie <ArrowRight size={15}/></button>}<span className="video-legal">Use a direct video file or an embeddable YouTube video. Streaming-service pages aren’t supported.</span></div>}</div>
    {reactions.length > 0 && <div className="reaction-burst-layer" aria-live="polite" aria-label="Room reactions">{reactions.map((reaction) => { const lane = [...reaction.id].reduce((value, character) => value + character.charCodeAt(0), 0) % 5; return <div className={`reaction-burst reaction-burst-${lane}`} key={reaction.id}><span className="reaction-burst-emoji" role="img" aria-label={`${reaction.name} reacted ${reaction.emoji}`}>{reaction.emoji}</span><span className="reaction-burst-name">{reaction.name}</span></div>; })}</div>}
    {media?.url && <div className="player-controls"><button className="control-play" disabled={!isAdmin} onClick={() => emit(playback.playing ? 'playback:pause' : 'playback:play', { position: scrubTime !== null ? scrubTime : time })} aria-label={playback.playing ? 'Pause' : 'Play'}>{playback.playing ? 'Ⅱ' : <Play size={17} fill="currentColor"/>}</button><span className="control-time">{fmt(scrubTime !== null ? scrubTime : time)}</span><input className="seek-bar" type="range" min={0} max={duration || 100} step={0.1} value={Math.min(scrubTime !== null ? scrubTime : time, duration || 100)} disabled={!isAdmin} onPointerDown={(event) => setScrubTime(Number(event.currentTarget.value))} onChange={(event) => { const val = Number(event.target.value); setScrubTime(val); seek(val); }} onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))} onMouseUp={(event) => commitSeek(Number(event.currentTarget.value))} onTouchEnd={(event) => commitSeek(Number(event.currentTarget.value))} onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) setScrubTime(Number(event.currentTarget.value)); }} onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commitSeek(Number(event.currentTarget.value)); }} onBlur={(event) => { if (scrubTime !== null) commitSeek(Number(event.currentTarget.value)); }}/><span className="control-time">{fmt(duration)}</span><button className="control-icon" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button><input className="volume-range" aria-label="Volume" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))}/><select className="speed-select" aria-label="Playback speed" value={speed} onChange={(event) => changeSpeed(Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}</select><button className="control-icon" onClick={toggleFullscreen} aria-label="Toggle fullscreen"><Maximize size={16}/></button></div>}
  </div>;
}
function ChatPanel({ messages, emit, user }: { messages: Message[]; emit: (event: string, payload?: unknown) => void; user: User | null }) {
  const [text, setText] = useState(''); const endRef = useRef<HTMLDivElement>(null); useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);
  const send = (e: FormEvent) => { e.preventDefault(); const value = text.trim(); if (!value) return; emit('chat:send', { message: value }); setText(''); };
  return <div className="chat-panel"><div className="chat-intro"><span className="chat-room-label"><span className="live-dot"/> LIVE CONVERSATION</span><p>React to the plot twists. Please, no spoilers. 💜</p></div><div className="chat-list">{messages.map((message) => message.messageType === 'system' ? <div className="system-message" key={message._id}><span/>{message.message}<span/></div> : message.messageType === 'reaction' ? <div className={`chat-reaction-message ${message.senderId === user?.id ? 'own-reaction' : ''}`} key={message._id}><div className="chat-avatar">{initials(message.senderName || 'G')}</div><div className="chat-reaction-content"><div className="chat-message-meta"><b>{message.senderName}</b><span>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><span className="chat-reaction-emoji" aria-label={`${message.senderName} reacted`}>{message.message}</span></div></div> : <div className={`chat-message ${message.senderId === user?.id ? 'own-message' : ''}`} key={message._id}><div className="chat-avatar">{initials(message.senderName || 'G')}</div><div className="chat-message-main"><div className="chat-message-meta"><b>{message.senderName}</b><span>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><p>{message.message}</p></div></div>)}{!messages.length && <div className="chat-empty"><MessageCircle size={22}/><b>It’s a quiet kind of magic.</b><span>Say hi when the movie starts.</span></div>}<div ref={endRef}/></div><div className="quick-reactions">{['❤️', '😂', '👏', '😮', '🔥', '😭'].map((emoji) => <button key={emoji} aria-label={`React ${emoji}`} onClick={() => emit('reaction:send', { emoji })}>{emoji}</button>)}</div><form className="chat-compose" onSubmit={send}><input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Say something nice…"/><button aria-label="Send message" disabled={!text.trim()}><Send size={16}/></button></form></div>;
}
function PeoplePanel({ participants, currentUser, isAdmin, online, onTransfer, onRemove }: { participants: Participant[]; currentUser: User | null; isAdmin: boolean; online: Record<string, boolean>; onTransfer: (participant: Participant) => void; onRemove: (participant: Participant) => void }) {
  return <div className="people-panel"><div className="people-summary"><div className="people-summary-icon"><Users size={17}/></div><div><b>{participants.length} in the room</b><span>Good company, great story.</span></div></div><div className="participant-list">{participants.map((p, index) => { const id = uid(p); const name = p.name || (typeof p.userId === 'object' ? p.userId.name : '') || (id === currentUser?.id ? currentUser.name : 'Movie friend'); return <div className="participant-row" key={id}><div className={`avatar ${index % 2 ? 'avatar-pink' : 'avatar-purple'}`}>{initials(name)}</div><div className="participant-info"><b>{name}{id === currentUser?.id && <small> YOU</small>}</b><span><i className={`presence-dot ${online[id] === false ? 'offline' : ''}`}/>{online[id] === false ? 'Reconnecting' : 'Watching now'}</span></div>{p.role === 'ADMIN' ? <span className="admin-tag"><Crown size={12}/> HOST</span> : isAdmin && <div className="participant-actions"><button title="Transfer admin" onClick={() => onTransfer(p)}><Crown size={14}/></button><button title="Remove participant" onClick={() => onRemove(p)}><X size={15}/></button></div>}</div>; })}</div><div className="people-note"><Sparkles size={15}/><span><b>Good nights are shared.</b><br/>Keep it kind, keep it spoiler-free.</span></div></div>;
}
export default App;
