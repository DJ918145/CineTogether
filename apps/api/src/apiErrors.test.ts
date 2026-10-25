import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './server';

describe('API error responses', () => {
  it('returns JSON for unknown routes', async () => {
    const response = await request(app).get('/api/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Not found.' });
  });

  it('returns a safe JSON 400 for malformed JSON', async () => {
    const response = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Request body contains invalid JSON.' });
  });

  it('returns a JSON 413 for oversized JSON', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ value: 'x'.repeat(33 * 1024) }));
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ message: 'Request body is too large.' });
  });

  it('returns JSON when the login rate limit is exceeded', async () => {
    const responses = await Promise.all(Array.from({ length: 11 }, () => request(app).post('/api/auth/login').send({})));
    const response = responses[10];
    expect(response?.status).toBe(429);
    expect(response?.body).toEqual({ message: 'Too many requests. Please wait before trying again.' });
  });
});
