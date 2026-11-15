import assert from 'node:assert/strict';
import test from 'node:test';
import { apiUrl } from '../src/api/api-url';

test('API URLs keep the local proxy when no origin is configured', () => {
  assert.equal(apiUrl('/auth/me'), '/api/auth/me');
  assert.equal(apiUrl('/events'), '/api/events');
});

test('API URLs use the configured origin for HTTP and SSE, preserving query strings', () => {
  const origin = 'https://api.teng.website';
  assert.equal(apiUrl('/trades?status=ACTIVE', origin), `${origin}/api/trades?status=ACTIVE`);
  assert.equal(apiUrl('/events', origin), `${origin}/api/events`);
});

test('a trailing origin slash does not create duplicate URL separators', () => {
  assert.equal(apiUrl('/auth/login', 'https://api.teng.website/'), 'https://api.teng.website/api/auth/login');
});
