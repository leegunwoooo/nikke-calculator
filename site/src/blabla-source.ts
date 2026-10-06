// 블라블라링크 프로필을 어디서 받아 오는가 — 두 경로를 둔다.
//
// 기본은 nikke-api의 GET /api/user/:blablaid/roster — 서버 측 자격증명으로 매 호출
// 세션을 새로 발급받으므로, 프록시(worker/)처럼 30일마다 쿠키를 손으로 갈아 끼울
// 필요가 없다. 응답 형태는 프록시 /sync와 같다(서버별 characters·details·
// stateEffects·outpost) — 여기선 openid 필드명만 옮겨 싣는다.
//
// 프록시는 폴백이다. nikke-api가 네트워크 오류나 5xx로 쓰러졌을 때만 간다 —
// «비공개»(404)나 «주소 오류»(400)는 어느 경로로 물어도 답이 같으므로 다시 묻지 않는다.
import type { RawProfile } from './blablalink';

/** nikke-api 배포 주소. 다른 인스턴스를 쓰려면 VITE_NIKKE_API로 바꿔 박는다. */
export const NIKKE_API = (
  import.meta.env.VITE_NIKKE_API ?? 'https://nikke-api-gunwoos-projects.vercel.app'
).trim().replace(/\/+$/, '');

/** 두 경로가 돌려주는 공통 모양 — 실패 시 error·reason을 읽는다. */
export interface SyncOutcome {
  ok: boolean;
  status: number;
  payload: RawProfile & { error?: string; reason?: string };
}

async function viaNikkeApi(apiBase: string, profileUrl: string, area?: number): Promise<SyncOutcome> {
  // 프로필 주소 통째를 ?url=로 넘긴다 — openid 추출 규칙은 서버가 이미 갖고 있어
  // 여기서 다시 만들면 두 규칙이 어긋난다.
  const params = new URLSearchParams({ url: profileUrl });
  if (area !== undefined) params.set('area', String(area));
  const response = await fetch(`${apiBase}/api/user/roster?${params}`);
  const payload = await response.json();
  if (payload.intlOpenId) payload.openid = payload.intlOpenId;
  return { ok: response.ok, status: response.status, payload };
}

async function viaWorker(proxy: string, profileUrl: string, area?: number): Promise<SyncOutcome> {
  const response = await fetch(`${proxy}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileUrl,
      ...(area === undefined ? {} : { area }),
    }),
  });
  return { ok: response.ok, status: response.status, payload: await response.json() };
}

export async function syncProfile(opts: {
  profileUrl: string;
  area?: number;
  /** Cloudflare 프록시 주소 — 비어 있으면 nikke-api 경로만 쓴다. */
  proxy?: string;
  /** 시험용 주입점. 보통은 NIKKE_API 기본값을 쓴다. */
  apiBase?: string;
}): Promise<SyncOutcome> {
  const apiBase = (opts.apiBase ?? NIKKE_API).trim().replace(/\/+$/, '');
  let apiResult: SyncOutcome | null = null;
  if (apiBase) {
    try {
      apiResult = await viaNikkeApi(apiBase, opts.profileUrl, opts.area);
      if (apiResult.ok || apiResult.status === 404 || apiResult.status === 400) return apiResult;
    } catch {
      /* API가 닿지 않으면 프록시로 간다 */
    }
  }
  const proxy = (opts.proxy ?? '').trim().replace(/\/+$/, '');
  if (proxy) return viaWorker(proxy, opts.profileUrl, opts.area);
  // 프록시가 없으면 API의 답(에러라도)이 마지막이다 — 부를 곳이 더 없다.
  if (apiResult) return apiResult;
  throw new Error('프로필 동기화 경로가 없습니다.');
}
