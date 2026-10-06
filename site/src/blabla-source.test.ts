import { afterEach, describe, expect, it, vi } from 'vitest';

import { syncProfile } from './blabla-source';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** nikke-api가 살아 있을 때 — 프록시는 불리지 않아야 한다 */
const apiOk = () =>
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/user/roster')) {
      return Response.json({
        intlOpenId: '12345',
        areas: [{ area: 83, characters: [], details: [], stateEffects: [], outpost: null }],
      });
    }
    throw new Error(`unexpected call: ${url}`);
  });

describe('syncProfile — nikke-api 우선, 프록시 폴백', () => {
  it('nikke-api 응답의 intlOpenId를 openid로 옮긴다', async () => {
    apiOk();
    const { ok, payload } = await syncProfile({ profileUrl: 'https://x/?openid=abc', apiBase: 'https://api.test' });
    expect(ok).toBe(true);
    expect(payload.openid).toBe('12345');
    expect(payload.areas?.[0]?.area).toBe(83);
  });

  it('«비공개»(404)는 결정적인 답 — 프록시로 다시 묻지 않는다', async () => {
    let workerCalled = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/user/roster')) {
        return Response.json({ error: 'nikke list is private', reason: 'private' }, { status: 404 });
      }
      if (url.endsWith('/sync')) {
        workerCalled = true;
        return Response.json({ openid: 'x', areas: [] });
      }
      throw new Error(`unexpected call: ${url}`);
    });
    const { ok, status, payload } = await syncProfile({
      profileUrl: 'x', apiBase: 'https://api.test', proxy: 'https://proxy.test',
    });
    expect(ok).toBe(false);
    expect(status).toBe(404);
    expect(payload.reason).toBe('private');
    expect(workerCalled).toBe(false);
  });

  it('API가 죽으면(5xx·네트워크 오류) 프록시로 폴백한다', async () => {
    let workerCalled = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/user/roster')) {
        return Response.json({ error: 'upstream' }, { status: 502 });
      }
      if (url.endsWith('/sync')) {
        workerCalled = true;
        return Response.json({ openid: '99999', areas: [] });
      }
      throw new Error(`unexpected call: ${url}`);
    });
    const { ok, payload } = await syncProfile({
      profileUrl: 'x', apiBase: 'https://api.test', proxy: 'https://proxy.test',
    });
    expect(workerCalled).toBe(true);
    expect(ok).toBe(true);
    expect(payload.openid).toBe('99999');
  });

  it('API에 아예 닿지 않으면(throw) 프록시로 폴백한다', async () => {
    let workerCalled = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/user/roster')) throw new Error('network down');
      if (url.endsWith('/sync')) {
        workerCalled = true;
        return Response.json({ openid: '7', areas: [] });
      }
      throw new Error(`unexpected call: ${url}`);
    });
    const { ok, payload } = await syncProfile({
      profileUrl: 'x', apiBase: 'https://api.test', proxy: 'https://proxy.test',
    });
    expect(workerCalled).toBe(true);
    expect(ok).toBe(true);
    expect(payload.openid).toBe('7');
  });

  it('프록시가 없으면 API의 답이 마지막이다 — 재호출 없이 에러를 그대로 돌린다', async () => {
    let apiCalls = 0;
    vi.stubGlobal('fetch', async () => {
      apiCalls += 1;
      return Response.json({ error: 'upstream', code: -1 }, { status: 502 });
    });
    const { ok, status } = await syncProfile({ profileUrl: 'x', apiBase: 'https://api.test' });
    expect(ok).toBe(false);
    expect(status).toBe(502);
    expect(apiCalls).toBe(1);
  });
});
