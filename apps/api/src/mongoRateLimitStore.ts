import mongoose from 'mongoose';
import type { Options, Store } from 'express-rate-limit';

type RateLimitCounter = { _id: string; totalHits: number; expiresAt: Date };

export class MongoRateLimitStore implements Store {
  localKeys = false;
  prefix: string;
  private windowMs = 60_000;
  private indexReady?: Promise<string>;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  private async collection() {
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB must be connected before using the shared rate-limit store.');
    const collection = db.collection<RateLimitCounter>('rateLimitCounters');
    this.indexReady ||= collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.indexReady;
    return collection;
  }

  async increment(key: string) {
    const collection = await this.collection();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.windowMs);
    const isActiveWindow = { $gt: ['$expiresAt', now] };
    await collection.updateOne(
      { _id: `${this.prefix}:${key}` },
      [{
        $set: {
          totalHits: { $cond: [isActiveWindow, { $add: [{ $ifNull: ['$totalHits', 0] }, 1] }, 1] },
          expiresAt: { $cond: [isActiveWindow, '$expiresAt', expiresAt] }
        }
      }],
      { upsert: true }
    );
    const counter = await collection.findOne({ _id: `${this.prefix}:${key}` });
    return { totalHits: counter?.totalHits ?? 1, resetTime: counter?.expiresAt };
  }

  async decrement(key: string) {
    const collection = await this.collection();
    await collection.updateOne({ _id: `${this.prefix}:${key}` }, { $inc: { totalHits: -1 } });
  }

  async resetKey(key: string) {
    const collection = await this.collection();
    await collection.deleteOne({ _id: `${this.prefix}:${key}` });
  }

  async resetAll() {
    const collection = await this.collection();
    await collection.deleteMany({ _id: { $regex: `^${this.prefix}:` } });
  }
}
