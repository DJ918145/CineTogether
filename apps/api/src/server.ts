import { config } from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

config({ path: path.resolve(__dirname, '../../../.env') });
import { createHash } from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ChatMessage, Media, Room, User } from './models';
import { directVideoUrlError, earliestActiveParticipant, expectedPlaybackPosition, youtubeVideoId } from './roomPolicy';

const app = express();
const server = http.createServer(app);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const jwtSecret = process.env.JWT_SECRET || 'local-development-secret-change-me';
const io = new Server(server, { cors: { origin: clientOrigin, credentials: true } });
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir, { maxAge: '1d', dotfiles: 'deny' }));
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

type TokenUser = { id: string; name: string };
type AuthedRequest = Request & { user?: TokenUser };
declare global { namespace Express { interface Request { user?: TokenUser } } }
const signToken = (user: TokenUser) => jwt.sign(user, jwtSecret, { expiresIn: '7d' });
function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.ct_session;
  if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });
  try { req.user = jwt.verify(token, jwtSecret) as TokenUser; next(); }
  catch { res.clearCookie('ct_session'); return res.status(401).json({ message: 'Your session expired. Please sign in again.' }); }
}
const asyncRoute = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req as AuthedRequest, res)).catch(next);
const cookieOptions = { httpOnly: true, sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 };
const oauthStateCookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60 * 1000 };
const googleCallbackUrl = process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CALLBACK_URL || `http://localhost:${process.env.PORT || 4000}/api/auth/google/callback`;
const publicUser = (user: any) => ({ id: String(user._id), name: user.name, email: user.email, avatar: user.avatar || '' });
const roomSchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(240).optional(), visibility: z.enum(['private', 'public']).default('private'), password: z.string().min(4).max(80).optional(), maxParticipants: z.coerce.number().int().min(2).max(20).default(8) });
const makeCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `CIN-${Array.from(randomBytes(4), (byte) => alphabet[byte % alphabet.length]).join('')}`;
};
const publicRoom = (room: any) => ({ _id: room._id, roomCode: room.roomCode, name: room.name, description: room.description, visibility: room.visibility, maxParticipants: room.maxParticipants, status: room.status, ownerId: room.ownerId, currentMedia: room.currentMedia, participants: room.participants, createdAt: room.createdAt });
const isValidObjectId = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'offline' }));
app.post('/api/auth/register', authLimiter, asyncRoute(async (req, res) => {
  const data = z.object({ name: z.string().trim().min(2).max(60), email: z.string().email().max(200), password: z.string().min(8).max(100) }).parse(req.body);
  const email = data.email.toLowerCase();
  if (await User.exists({ email })) return res.status(409).json({ message: 'An account with this email already exists.' });
  const user = await User.create({ name: data.name, email, passwordHash: await bcrypt.hash(data.password, 12) });
  res.cookie('ct_session', signToken({ id: String(user._id), name: user.name }), cookieOptions).status(201).json({ user: { ...publicUser(user), authProviders: { password: true, google: false } } });
}));
app.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res) => {
  const data = z.object({ email: z.string().email(), password: z.string().min(1).max(100) }).parse(req.body);
  const user = await User.findOne({ email: data.email.toLowerCase() });
  if (!user?.passwordHash || !await bcrypt.compare(data.password, user.passwordHash)) return res.status(401).json({ message: 'Email or password is incorrect. If you registered with Google, continue with Google.' });
  res.cookie('ct_session', signToken({ id: String(user._id), name: user.name }), cookieOptions).json({ user: { ...publicUser(user), authProviders: { password: true, google: Boolean(user.googleId) } } });
}));
function createGoogleAuthorizationUrl() {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
  if (!clientId || !clientSecret) return null;
  const state = randomBytes(32).toString('hex');
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', googleCallbackUrl);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'openid email profile');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('prompt', 'select_account');
  return { url: authorizationUrl.toString(), state };
}
app.get('/api/auth/google/url', (req, res) => {
  const authorization = createGoogleAuthorizationUrl();
  if (!authorization) return res.status(503).json({ message: 'Google OAuth is not configured.' });
  res.cookie('ct_oauth_state', authorization.state, oauthStateCookieOptions);
  res.json({ url: authorization.url });
});
app.get('/api/auth/google', (req, res) => {
  const authorization = createGoogleAuthorizationUrl();
  if (!authorization) return res.redirect(`${clientOrigin}/login?error=google_not_configured`);
  res.cookie('ct_oauth_state', authorization.state, oauthStateCookieOptions);
  res.redirect(authorization.url);
});
app.get('/api/auth/google/callback', asyncRoute(async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const expectedState = req.cookies?.ct_oauth_state;
  res.clearCookie('ct_oauth_state', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  if (!state || !expectedState || state !== expectedState || !code) return res.redirect(`${clientOrigin}/login?error=google_auth_failed`);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.redirect(`${clientOrigin}/login?error=google_not_configured`);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: googleCallbackUrl, grant_type: 'authorization_code' })
  });
  if (!tokenResponse.ok) return res.redirect(`${clientOrigin}/login?error=google_auth_failed`);
  const tokenPayload = await tokenResponse.json() as { access_token?: string };
  if (!tokenPayload.access_token) return res.redirect(`${clientOrigin}/login?error=google_auth_failed`);

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokenPayload.access_token}` } });
  if (!profileResponse.ok) return res.redirect(`${clientOrigin}/login?error=google_auth_failed`);
  const profile = await profileResponse.json() as { id?: string; email?: string; verified_email?: boolean; name?: string; picture?: string };
  if (!profile.id || !profile.email || !profile.verified_email) return res.redirect(`${clientOrigin}/login?error=google_email_unverified`);

  const email = profile.email.toLowerCase();
  let user = await User.findOne({ googleId: profile.id });
  if (user && user.email !== email) return res.redirect(`${clientOrigin}/login?error=google_auth_failed`);
  if (!user) {
    user = await User.findOne({ email });
    if (user?.googleId && user.googleId !== profile.id) return res.redirect(`${clientOrigin}/login?error=google_auth_failed`);
  }
  if (user) {
    user.googleId = profile.id;
    if (profile.name && !user.name) user.name = profile.name.slice(0, 60);
    if (profile.picture && !user.avatar) user.avatar = profile.picture.slice(0, 1000);
    await user.save();
  } else {
    user = await User.create({ name: (profile.name || email.split('@')[0]).slice(0, 60), email, googleId: profile.id, avatar: profile.picture?.slice(0, 1000) });
  }
  res.cookie('ct_session', signToken({ id: String(user._id), name: user.name }), cookieOptions).redirect(`${clientOrigin}/app`);
}));
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('ct_session', { httpOnly: true, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', secure: process.env.NODE_ENV === 'production' }); res.json({ message: 'Signed out.' }); });
app.post('/api/auth/forgot-password', authLimiter, asyncRoute(async (req, res) => {
  const { email } = z.object({ email: z.string().email().max(200) }).parse(req.body);
  const user = await User.findOne({ email: email.toLowerCase() });
  let resetUrl: string | undefined;
  if (user) {
    const token = randomBytes(32).toString('hex');
    user.set({ passwordResetHash: createHash('sha256').update(token).digest('hex'), passwordResetExpiresAt: new Date(Date.now() + 30 * 60_000) });
    await user.save();
    if (process.env.NODE_ENV !== 'production') resetUrl = `${clientOrigin}/forgot-password?token=${token}`;
  }
  res.json({ message: 'If an account exists for that email, password reset instructions are on their way.', ...(resetUrl ? { resetUrl } : {}) });
}));
app.post('/api/auth/reset-password', authLimiter, asyncRoute(async (req, res) => {
  const data = z.object({ token: z.string().length(64), password: z.string().min(8).max(100) }).parse(req.body);
  const resetHash = createHash('sha256').update(data.token).digest('hex');
  const user = await User.findOne({ passwordResetHash: resetHash, passwordResetExpiresAt: { $gt: new Date() } });
  if (!user) return res.status(400).json({ message: 'This password reset link is invalid or has expired.' });
  user.passwordHash = await bcrypt.hash(data.password, 12);
  user.set({ passwordResetHash: undefined, passwordResetExpiresAt: undefined });
  await user.save();
  res.json({ message: 'Password updated. You can now log in with your new password.' });
}));
app.get('/api/auth/me', requireAuth, asyncRoute(async (req, res) => {
  const user = await User.findById(req.user!.id).select('_id name email avatar googleId');
  if (!user) return res.status(401).json({ message: 'Account not found.' });
  res.json({ user: { ...publicUser(user), authProviders: { password: Boolean(user.passwordHash), google: Boolean(user.googleId) } } });
}));
app.patch('/api/auth/profile', requireAuth, asyncRoute(async (req, res) => {
  const data = z.object({ name: z.string().trim().min(2).max(60), avatar: z.union([z.literal(''), z.string().url().max(1000)]).optional() }).parse(req.body);
  if (data.avatar && new URL(data.avatar).protocol !== 'https:') return res.status(400).json({ message: 'Profile photo URLs must use HTTPS.' });
  const user = await User.findByIdAndUpdate(req.user!.id, { $set: { name: data.name, ...(data.avatar !== undefined ? { avatar: data.avatar } : {}) } }, { new: true, runValidators: true }).select('_id name email avatar googleId passwordHash');
  if (!user) return res.status(404).json({ message: 'Account not found.' });
  res.cookie('ct_session', signToken({ id: String(user._id), name: user.name }), cookieOptions).json({ user: { ...publicUser(user), authProviders: { password: Boolean(user.passwordHash), google: Boolean(user.googleId) } } });
}));

app.post('/api/rooms', requireAuth, asyncRoute(async (req, res) => {
  const data = roomSchema.parse(req.body);
  const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : undefined;
  let roomCode = makeCode();
  while (await Room.exists({ roomCode })) roomCode = makeCode();
  const room = await Room.create({ ...data, passwordHash, roomCode, ownerId: req.user!.id, participants: [{ userId: req.user!.id, name: req.user!.name, role: 'ADMIN' }] });
  res.status(201).json({ room: publicRoom(room), inviteUrl: `${clientOrigin}/room/${roomCode}` });
}));
app.get('/api/rooms', requireAuth, asyncRoute(async (req, res) => {
  const rooms = await Room.find({ 'participants.userId': req.user!.id, status: { $ne: 'closed' } }).sort({ updatedAt: -1 }).limit(12).select('-passwordHash');
  res.json({ rooms: rooms.map(publicRoom) });
}));
app.get('/api/rooms/:roomCode', requireAuth, asyncRoute(async (req, res) => {
  const room = await Room.findOne({ roomCode: String(req.params.roomCode).toUpperCase(), status: { $ne: 'closed' } }).select('-passwordHash');
  if (!room) return res.status(404).json({ message: 'We couldn’t find that room.' });
  const member = room.participants.some((p: any) => String(p.userId) === req.user!.id && p.isActive);
  if (room.visibility === 'private' && !member) return res.status(403).json({ message: 'This is a private room. Join with an invitation.' });
  res.json({ room: publicRoom(room) });
}));
app.get('/api/rooms/:roomCode/participants', requireAuth, asyncRoute(async (req, res) => {
  const room = await Room.findOne({ roomCode: String(req.params.roomCode).toUpperCase() });
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (!room.participants.some((p: any) => String(p.userId) === req.user!.id && p.isActive)) return res.status(403).json({ message: 'Join this room to view its participants.' });
  res.json({ participants: room.participants.filter((p: any) => p.isActive) });
}));
app.post('/api/rooms/:roomCode/join', requireAuth, asyncRoute(async (req, res) => {
  const room = await Room.findOne({ roomCode: String(req.params.roomCode).toUpperCase(), status: { $ne: 'closed' } });
  if (!room) return res.status(404).json({ message: 'We couldn’t find that room.' });
  const existing = room.participants.find((p: any) => String(p.userId) === req.user!.id);
  if (existing?.isActive) return res.json({ room: publicRoom(room) });
  if (room.visibility === 'private' && room.passwordHash && !await bcrypt.compare(String(req.body.password || ''), room.passwordHash)) return res.status(401).json({ message: 'That room password is not correct.' });
  const active = room.participants.filter((p: any) => p.isActive).length;
  if (active >= room.maxParticipants) return res.status(409).json({ message: 'This room is full.' });
  if (existing) {
    existing.isActive = true;
    existing.joinedAt = new Date();
    if (String(existing.userId) !== String(room.ownerId)) {
      existing.role = 'MEMBER';
    }
  }
  else room.participants.push({ userId: req.user!.id, name: req.user!.name, role: 'MEMBER', joinedAt: new Date(), isActive: true } as any);
  await room.save();
  const systemMessage = await ChatMessage.create({ roomId: room._id, senderId: req.user!.id, senderName: req.user!.name, message: `${req.user!.name} joined the movie night.`, messageType: 'system' });
  io.to(String(room._id)).emit('participants:update', room.participants);
  io.to(String(room._id)).emit('chat:message', systemMessage);
  res.json({ room: publicRoom(room) });
}));
async function leaveRoom(room: any, userId: string, name: string) {
  const participant = room.participants.find((p: any) => String(p.userId) === userId && p.isActive);
  if (!participant) return;
  const wasAdmin = participant.role === 'ADMIN';
  participant.isActive = false;
  if (wasAdmin) {
    participant.role = 'MEMBER';
    const successor = earliestActiveParticipant(room.participants);
    if (successor) { successor.role = 'ADMIN'; room.ownerId = successor.userId; }
    else room.status = 'closed';
  }
  await room.save();
  const connected = onlineByRoom.get(String(room._id))?.get(userId);
  connected?.sockets.forEach((socketId) => {
    const activeSocket = io.sockets.sockets.get(socketId);
    activeSocket?.leave(String(room._id));
    activeSocket?.emit('room:left');
  });
  if (connected?.timer) clearTimeout(connected.timer);
  onlineByRoom.get(String(room._id))?.delete(userId);
  const leaveMessage = await ChatMessage.create({ roomId: room._id, senderId: room.ownerId, senderName: 'CineTogether', message: `${name} left the movie night.${room.status === 'closed' ? ' The room is now closed.' : ''}`, messageType: 'system' });
  io.to(String(room._id)).emit('chat:message', leaveMessage);
  if (wasAdmin && room.status !== 'closed') {
    const promoted = room.participants.find((p: any) => String(p.userId) === String(room.ownerId));
    if (promoted) {
      const transferMessage = await ChatMessage.create({ roomId: room._id, senderId: room.ownerId, senderName: 'CineTogether', message: `Admin rights transferred to ${promoted.name}.`, messageType: 'system' });
      io.to(String(room._id)).emit('chat:message', transferMessage);
    }
  }
  io.to(String(room._id)).emit('participants:update', room.participants);
  io.to(String(room._id)).emit('room:state', { room: publicRoom(room), adminChanged: true });
  if (room.status === 'closed') io.to(String(room._id)).emit('room:closed');
}
app.post('/api/rooms/:roomCode/leave', requireAuth, asyncRoute(async (req, res) => {
  const room = await Room.findOne({ roomCode: String(req.params.roomCode).toUpperCase() });
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  await leaveRoom(room, req.user!.id, req.user!.name);
  res.json({ message: 'You left the room.' });
}));
app.post('/api/rooms/:roomCode/transfer-admin', requireAuth, asyncRoute(async (req, res) => {
  const room = await Room.findOne({ roomCode: String(req.params.roomCode).toUpperCase() });
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (String(room.ownerId) !== req.user!.id) return res.status(403).json({ message: 'Only the room admin can transfer ownership.' });
  if (typeof req.body.userId !== 'string' || !/^[a-f\d]{24}$/i.test(req.body.userId)) return res.status(400).json({ message: 'Choose a valid room participant.' });
  const target = room.participants.find((p: any) => String(p.userId) === req.body.userId && p.isActive);
  if (!target) return res.status(400).json({ message: 'Choose a participant who is currently in the room.' });
  const targetId = new mongoose.Types.ObjectId(req.body.userId);
  const ownershipUpdate = [{
    $set: {
      ownerId: targetId,
      participants: {
        $map: {
          input: '$participants',
          as: 'participant',
          in: {
            $mergeObjects: [
              '$$participant',
              { role: { $cond: [{ $eq: ['$$participant.userId', targetId] }, 'ADMIN', 'MEMBER'] } }
            ]
          }
        }
      }
    }
  }];
  const updatedRoom = await Room.findOneAndUpdate(
    { _id: room._id, ownerId: req.user!.id, participants: { $elemMatch: { userId: targetId, isActive: true } } },
    ownershipUpdate,
    { new: true }
  );
  if (!updatedRoom) return res.status(409).json({ message: 'Room ownership changed. Refresh and try again.' });
  const targetUser = await User.findById(req.body.userId).select('name');
  const systemMessage = await ChatMessage.create({ roomId: room._id, senderId: req.user!.id, senderName: req.user!.name, message: `${req.user!.name} transferred admin rights to ${targetUser?.name || 'a participant'}.`, messageType: 'system' });
  io.to(String(room._id)).emit('participants:update', updatedRoom.participants);
  io.to(String(room._id)).emit('room:state', { room: publicRoom(updatedRoom) });
  io.to(String(room._id)).emit('chat:message', systemMessage);
  res.json({ room: publicRoom(updatedRoom) });
}));
app.post('/api/rooms/:roomCode/remove-participant', requireAuth, asyncRoute(async (req, res) => {
  const room = await Room.findOne({ roomCode: String(req.params.roomCode).toUpperCase() });
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (String(room.ownerId) !== req.user!.id) return res.status(403).json({ message: 'Only the room admin can remove participants.' });
  if (typeof req.body.userId !== 'string' || !/^[a-f\d]{24}$/i.test(req.body.userId)) return res.status(400).json({ message: 'Choose a valid room participant.' });
  const p = room.participants.find((item: any) => String(item.userId) === req.body.userId && item.isActive);
  if (!p || p.role === 'ADMIN') return res.status(400).json({ message: 'That participant cannot be removed.' });
  p.isActive = false;
  await room.save();
  const sockets = onlineByRoom.get(String(room._id))?.get(req.body.userId);
  sockets?.sockets.forEach((socketId) => {
    const activeSocket = io.sockets.sockets.get(socketId);
    activeSocket?.leave(String(room._id));
    activeSocket?.emit('room:removed', { roomCode: room.roomCode });
  });
  if (sockets?.timer) clearTimeout(sockets.timer);
  onlineByRoom.get(String(room._id))?.delete(req.body.userId);
  io.to(String(room._id)).emit('participants:update', room.participants);
  res.json({ room: publicRoom(room) });
}));
app.patch('/api/rooms/:roomCode/settings', requireAuth, asyncRoute(async (req, res) => {
  const room = await Room.findOne({ roomCode: String(req.params.roomCode).toUpperCase() });
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (String(room.ownerId) !== req.user!.id) return res.status(403).json({ message: 'Only the room admin can change settings.' });
  const data = roomSchema.partial().parse(req.body);
  room.set({ name: data.name ?? room.name, description: data.description ?? room.description, maxParticipants: data.maxParticipants ?? room.maxParticipants, visibility: data.visibility ?? room.visibility });
  await room.save(); res.json({ room: publicRoom(room) });
}));
app.delete('/api/rooms/:roomCode', requireAuth, asyncRoute(async (req, res) => {
  const room = await Room.findOne({ roomCode: String(req.params.roomCode).toUpperCase() });
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (String(room.ownerId) !== req.user!.id) return res.status(403).json({ message: 'Only the room admin can close it.' });
  room.status = 'closed'; room.participants.forEach((p: any) => { p.isActive = false; }); await room.save();
  const message = await ChatMessage.create({ roomId: room._id, senderId: req.user!.id, senderName: 'CineTogether', message: `${req.user!.name} closed the movie night.`, messageType: 'system' });
  io.to(String(room._id)).emit('chat:message', message); io.to(String(room._id)).emit('room:closed');
  playback.delete(String(room._id)); onlineByRoom.delete(String(room._id)); io.in(String(room._id)).socketsLeave(String(room._id));
  res.json({ message: 'Room closed.' });
}));
app.get('/api/rooms/:roomCode/messages', requireAuth, asyncRoute(async (req, res) => {
  const room = await Room.findOne({ roomCode: String(req.params.roomCode).toUpperCase() });
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (!room.participants.some((p: any) => String(p.userId) === req.user!.id && p.isActive)) return res.status(403).json({ message: 'Join the room to view its chat.' });
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const messages = await ChatMessage.find({ roomId: room._id }).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ messages: messages.reverse() });
}));

const storage = multer.diskStorage({ destination: uploadDir, filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`) });
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'].includes(file.mimetype)) });
app.post('/api/media/upload', requireAuth, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Choose an MP4, WebM, OGG, or MOV video under 1 GB.' });
  const mediaUrl = `${process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`}/uploads/${req.file.filename}`;
  void Media.create({ title: req.body.title?.slice(0, 100) || path.basename(req.file.originalname, path.extname(req.file.originalname)), sourceType: 'upload', sourceUrl: mediaUrl, storageKey: req.file.filename, ownerId: req.user!.id, mimeType: req.file.mimetype })
    .then((media) => res.status(201).json({ media: { _id: media._id, title: media.title, url: media.sourceUrl, mimeType: media.mimeType } }))
    .catch((error) => { console.error('Media record creation failed:', error); fs.unlink(req.file!.path, () => {}); res.status(500).json({ message: 'Could not save this video to your library.' }); });
});
app.get('/api/media', requireAuth, asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const [items, total] = await Promise.all([Media.find({ ownerId: req.user!.id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Media.countDocuments({ ownerId: req.user!.id })]);
  res.json({ media: items, page, limit, total });
}));
app.post('/api/media', requireAuth, asyncRoute(async (req, res) => {
  const data = z.object({ title: z.string().trim().min(1).max(100), description: z.string().max(240).optional(), sourceUrl: z.string().url().max(1200), mimeType: z.string().max(100).optional() }).parse(req.body);
  const urlError = directVideoUrlError(data.sourceUrl);
  if (urlError) return res.status(400).json({ message: urlError });
  const media = await Media.create({ ...data, sourceType: 'url', ownerId: req.user!.id });
  res.status(201).json({ media });
}));
app.get('/api/media/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Video not found in your library.' });
  const media = await Media.findOne({ _id: req.params.id, ownerId: req.user!.id });
  if (!media) return res.status(404).json({ message: 'Video not found in your library.' });
  res.json({ media });
}));
app.delete('/api/media/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Video not found in your library.' });
  const media = await Media.findOneAndDelete({ _id: req.params.id, ownerId: req.user!.id });
  if (!media) return res.status(404).json({ message: 'Video not found in your library.' });
  if (media.storageKey) fs.unlink(path.join(uploadDir, path.basename(media.storageKey)), () => {});
  res.json({ message: 'Video removed from your library.' });
}));
app.post('/api/rooms/:roomCode/media', requireAuth, asyncRoute(async (req, res) => {
  const data = z.object({ title: z.string().trim().min(1).max(100).optional(), url: z.string().url().max(1000).optional(), mediaId: z.string().optional() }).refine((value) => Boolean(value.mediaId || (value.title && value.url)), 'Choose a library video or provide a title and direct URL.').parse(req.body);
  const room = await Room.findOne({ roomCode: String(req.params.roomCode).toUpperCase() });
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (String(room.ownerId) !== req.user!.id) return res.status(403).json({ message: 'Only the room admin can choose a movie.' });
  if (data.mediaId && !isValidObjectId(data.mediaId)) return res.status(404).json({ message: 'That video is not in your library.' });
  const candidateUrl = data.url || (data.mediaId ? (await Media.findOne({ _id: data.mediaId, ownerId: req.user!.id }))?.sourceUrl : undefined);
  if (!candidateUrl) return res.status(404).json({ message: 'That video is not in your library.' });
  const candidateUrlError = directVideoUrlError(candidateUrl);
  if (candidateUrlError) return res.status(400).json({ message: candidateUrlError });
  let libraryItem = data.mediaId ? await Media.findOne({ _id: data.mediaId, ownerId: req.user!.id }) : null;
  if (data.mediaId && !libraryItem) return res.status(404).json({ message: 'That video is not in your library.' });
  if (!libraryItem) libraryItem = await Media.create({ title: data.title, sourceType: 'url', sourceUrl: data.url, mimeType: data.url && youtubeVideoId(data.url) ? 'video/youtube' : undefined, ownerId: req.user!.id });
  const title = libraryItem?.title || data.title!;
  const rawUrl = libraryItem?.sourceUrl || data.url!;
  const url = rawUrl.startsWith('/') ? `${process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`}${rawUrl}` : rawUrl;
  const urlError = directVideoUrlError(url);
  if (urlError) return res.status(400).json({ message: urlError });
  room.currentMedia = { title, url, mediaId: libraryItem ? String(libraryItem._id) : undefined, mimeType: youtubeVideoId(url) ? 'video/youtube' : libraryItem?.mimeType || 'video/mp4' }; room.status = 'watching'; await room.save();
  const roomIdStr = String(room._id);
  if ((onlineByRoom.get(roomIdStr)?.size ?? 0) > 0) {
    playback.set(roomIdStr, { position: 0, playing: false, updatedAt: Date.now() });
  } else {
    playback.delete(roomIdStr);
  }
  io.to(roomIdStr).emit('playback:movie-change', { media: room.currentMedia });
  const message = await ChatMessage.create({ roomId: room._id, senderId: req.user!.id, senderName: req.user!.name, message: `${req.user!.name} changed the movie to ${title}.`, messageType: 'system' });
  io.to(roomIdStr).emit('chat:message', message);
  res.json({ room: publicRoom(room) });
}));

const playback = new Map<string, { position: number; playing: boolean; updatedAt: number }>();
const onlineByRoom = new Map<string, Map<string, { sockets: Set<string>; timer?: NodeJS.Timeout }>>();
const PLAYBACK_TTL_MS = 60 * 60 * 1000;
function prunePlaybackMap() {
  const now = Date.now();
  for (const [roomId, state] of playback.entries()) {
    const hasOnline = (onlineByRoom.get(roomId)?.size ?? 0) > 0;
    if (!hasOnline || now - state.updatedAt > PLAYBACK_TTL_MS) {
      if (!hasOnline) playback.delete(roomId);
    }
  }
}
function readSocketUser(cookie: string | undefined): TokenUser | null {
  const token = cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('ct_session='))?.slice('ct_session='.length);
  if (!token) return null;
  try { return jwt.verify(decodeURIComponent(token), jwtSecret) as TokenUser; } catch { return null; }
}
io.use((socket, next) => { const user = readSocketUser(socket.handshake.headers.cookie); if (!user) return next(new Error('Authentication required')); socket.data.user = user; next(); });
io.on('connection', (socket) => {
  const user = socket.data.user as TokenUser;
  socket.join(`user:${user.id}`);
  socket.on('room:join', async ({ roomCode }: { roomCode: string }) => {
    try {
      const room = await Room.findOne({ roomCode: String(roomCode).toUpperCase(), status: { $ne: 'closed' } });
      if (!room || !room.participants.some((p: any) => String(p.userId) === user.id && p.isActive)) return socket.emit('room:error', { message: 'Join the room before connecting to its live session.' });
      const id = String(room._id); socket.data.roomId = id; socket.join(id);
      let members = onlineByRoom.get(id); if (!members) { members = new Map(); onlineByRoom.set(id, members); }
      let entry = members.get(user.id); if (!entry) { entry = { sockets: new Set() }; members.set(user.id, entry); }
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
      entry.sockets.add(socket.id);
      const state = playback.get(id) || { position: 0, playing: false, updatedAt: Date.now() };
      socket.emit('room:state', { room: publicRoom(room), playback: state });
      const messages = await ChatMessage.find({ roomId: room._id }).sort({ createdAt: -1 }).limit(40).lean();
      socket.emit('chat:history', messages.reverse());
      io.to(id).emit('presence:update', { userId: user.id, online: true });
    } catch { socket.emit('room:error', { message: 'Could not connect to this room.' }); }
  });
  const playEvent = async (event: 'playback:play' | 'playback:pause' | 'playback:seek', data: { position?: number }) => {
    const id = socket.data.roomId as string | undefined; if (!id) return;
    const room = await Room.findById(id); if (!room || String(room.ownerId) !== user.id) return socket.emit('room:error', { message: 'Only the room admin can control playback.' });
    const now = Date.now();
    const prev = playback.get(id) || { position: 0, playing: false, updatedAt: now };
    const currentEstimated = expectedPlaybackPosition(prev, now);
    const targetPos = (typeof data?.position === 'number' && !Number.isNaN(data.position)) ? data.position : currentEstimated;
    const position = Math.max(0, Math.min(Number(targetPos) || 0, 24 * 60 * 60));
    const playing = event === 'playback:play' ? true : event === 'playback:pause' ? false : prev.playing;
    const state = { position, playing, updatedAt: now };
    playback.set(id, state);
    prunePlaybackMap();
    io.to(id).emit('playback:sync', { ...state, changedBy: user.id });
  };
  socket.on('playback:play', (data) => void playEvent('playback:play', data));
  socket.on('playback:pause', (data) => void playEvent('playback:pause', data));
  socket.on('playback:seek', (data) => void playEvent('playback:seek', data));
  socket.on('playback:ended', async () => { const id = socket.data.roomId as string | undefined; if (!id) return; const room = await Room.findById(id); if (room && String(room.ownerId) === user.id) { playback.set(id, { position: 0, playing: false, updatedAt: Date.now() }); io.to(id).emit('playback:ended'); } });
  socket.on('chat:send', async ({ message }: { message: string }) => {
    const now = Date.now(); const sentAt = (socket.data.chatSentAt as number[] | undefined) || [];
    const recent = sentAt.filter((timestamp) => now - timestamp < 10_000);
    if (recent.length >= 8) return socket.emit('room:error', { message: 'Slow down a little before sending another message.' });
    const id = socket.data.roomId as string | undefined; const text = typeof message === 'string' ? message.trim().slice(0, 500) : '';
    if (!id || !text) return;
    const room = await Room.findById(id);
    if (!room?.participants.some((p: any) => String(p.userId) === user.id && p.isActive)) return;
    const doc = await ChatMessage.create({ roomId: id, senderId: user.id, senderName: user.name, message: text, messageType: 'text' });
    recent.push(now); socket.data.chatSentAt = recent;
    io.to(id).emit('chat:message', { _id: doc._id, senderId: user.id, senderName: user.name, message: text, messageType: 'text', createdAt: doc.createdAt });
  });
  socket.on('reaction:send', async ({ emoji }: { emoji: string }) => { const id = socket.data.roomId as string | undefined; if (!id || !['❤️', '😂', '👏', '😮', '🔥', '😭'].includes(emoji)) return; io.to(id).emit('reaction:received', { emoji, userId: user.id, name: user.name }); });
  socket.on('disconnect', () => {
    const id = socket.data.roomId as string | undefined; if (!id) return;
    const members = onlineByRoom.get(id); const entry = members?.get(user.id); if (!entry) return;
    entry.sockets.delete(socket.id);
    if (!entry.sockets.size) entry.timer = setTimeout(async () => {
      if (entry.sockets.size) return;
      members?.delete(user.id); io.to(id).emit('presence:update', { userId: user.id, online: false });
      try { const room = await Room.findById(id); if (room) await leaveRoom(room, user.id, user.name); } catch (error) { console.error('Disconnect cleanup failed', error); }
      if (members?.size === 0) { onlineByRoom.delete(id); playback.delete(id); }
    }, 12_000);
  });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message || 'Please check the submitted information.' });
  if (error instanceof multer.MulterError) return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Video file must be smaller than 1 GB.' : 'Video upload failed.' });
  if (error instanceof mongoose.Error.CastError || (error as any)?.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid identifier format.' });
  }
  console.error('Request failed:', error);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
});

export { app, server, io };
const port = Number(process.env.PORT || 4000);
if (process.env.NODE_ENV !== 'test') {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be configured in production.');
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cinetogether')
    .then(() => server.listen(port, () => console.log(`CineTogether API listening on http://localhost:${port}`)))
    .catch((error) => { console.error('MongoDB connection failed:', error.message); process.exit(1); });
}
