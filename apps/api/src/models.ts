import mongoose, { Schema } from 'mongoose';

const UserSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String },
  tokenVersion: { type: Number, default: 0 },
  googleId: { type: String, unique: true, sparse: true, index: true },
  avatar: { type: String, maxlength: 1000 },
  passwordResetHash: { type: String },
  passwordResetExpiresAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

const RoomSessionSchema = new Schema({
  joinedAt: { type: Date, required: true },
  leftAt: { type: Date }
}, { _id: false });

const RoomMediaHistorySchema = new Schema({
  title: { type: String, required: true },
  url: { type: String, required: true },
  mediaId: { type: String },
  mimeType: { type: String },
  selectedAt: { type: Date, required: true }
}, { _id: false });

const ParticipantSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, enum: ['ADMIN', 'MEMBER'], default: 'MEMBER' },
  joinedAt: { type: Date, default: Date.now },
  sessions: { type: [RoomSessionSchema], default: [] },
  isActive: { type: Boolean, default: true }
}, { _id: false });

const RoomSchema = new Schema({
  roomCode: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, maxlength: 240, default: '' },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  creatorId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  visibility: { type: String, enum: ['private', 'public'], default: 'private' },
  passwordHash: { type: String },
  maxParticipants: { type: Number, min: 2, max: 20, default: 8 },
  status: { type: String, enum: ['waiting', 'watching', 'closed'], default: 'waiting' },
  currentMedia: { title: String, url: String, mediaId: String, mimeType: String },
  mediaHistory: { type: [RoomMediaHistorySchema], default: [] },
  participants: { type: [ParticipantSchema], default: [] },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

const MessageSchema = new Schema({
  roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  senderName: { type: String, required: true },
  message: { type: String, required: true, maxlength: 500 },
  messageType: { type: String, enum: ['text', 'system', 'reaction'], default: 'text' }
}, { timestamps: { createdAt: true, updatedAt: false } });
MessageSchema.index({ roomId: 1, createdAt: -1 });

const MediaSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 240, default: '' },
  sourceType: { type: String, enum: ['upload', 'url'], required: true },
  sourceUrl: { type: String, required: true, maxlength: 1200 },
  storageKey: { type: String },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  duration: { type: Number, min: 0 },
  mimeType: { type: String, maxlength: 100 }
}, { timestamps: true });
MediaSchema.index({ ownerId: 1, createdAt: -1 });

export const User = mongoose.models.User || mongoose.model('User', UserSchema);
export const Room = mongoose.models.Room || mongoose.model('Room', RoomSchema);
export const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', MessageSchema);
export const Media = mongoose.models.Media || mongoose.model('Media', MediaSchema);
