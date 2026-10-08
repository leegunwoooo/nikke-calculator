/**
 * 벨로타 : 펌킨 위치 (프리뷰 · Lv10 카드 전사) — char-add 단계 4 검증.
 *
 * «자신의 우측 자리 아군 1기»는 스쿼드 자리 순서의 바로 오른쪽 슬롯(`allies_right:1`)이다.
 * 유령 분장은 full_burst_start마다 자신에게 걸리는 상태라 본인 버스트 미사용 사이클에도
 * 스킬1·스킬2가 돌고, 버스트 2종 버프만 격사이클로 발동한다.
 * 시나리오: context/scenarios/벨로타 _ 펌킨 위치.md
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { build_config, build_squad } from '../spec';
import { simulate } from '../timeline';
import { loadEngineData, readJson } from './helpers';

const BEL = '벨로타 : 펌킨 위치';

// 표준 B2·40s 템플릿 — 벨로타 2번 슬롯, 우측 아군 = 크라운
const STD = ['리틀 머메이드', BEL, '크라운', 'test_B3', '스노우 화이트 : 헤비암즈'];
// 우측 없음 — 벨로타 맨 오른쪽 배치
const NO_RIGHT = ['리틀 머메이드', '크라운', 'test_B3', '스노우 화이트 : 헤비암즈', BEL];

beforeAll(loadEngineData);

function run(names: string[], duration = 60) {
  const squad = build_squad(names);
  const cfg = build_config(squad, { duration, rng_mode: 'expected' });
  return simulate(squad, cfg, { code: '', core_px: 0 }, true).log!;
}

function activations(log: any, name: string) {
  return log.buff_events.filter((e: any) => e.name === name && e.kind === 'activate');
}

describe('벨로타 : 펌킨 위치 (프리뷰)', () => {
  it('test_registered', () => {
    const skills = readJson<Record<string, any[]>>('data/parsed_skills.json');
    const entries = skills[BEL]!;
    expect(entries.length).toBe(7);
    expect(entries.every((e) => Object.keys(e.values ?? {}).join(',') === '10' || !('values' in e))).toBe(true);
  });

  it('우측 아군에게만 버프가 걸린다 — 스킬1·버스트 대상 = 크라운', () => {
    const log = run(STD);
    const s1Targets = new Set(activations(log, '플레이풀 리틀 위치').map((e: any) => e.target));
    const burstTargets = new Set(activations(log, '해피 할로윈!').map((e: any) => e.target));
    expect([...s1Targets]).toEqual(['크라운']);
    expect([...burstTargets]).toEqual(['크라운']);
    expect(activations(log, '트릭 오어 트릿!').every((e: any) => e.target === '크라운')).toBe(true);
  });

  it('스킬1은 매 풀버스트마다, 버스트 버프는 본인 사용 사이클에만 발동한다', () => {
    const log = run(STD, 60);
    const fullBursts = log.burst_log.filter((e: any) => e.event === 'full_burst 시작');
    const skill1 = activations(log, '플레이풀 리틀 위치');
    const burst = activations(log, '해피 할로윈!');
    // 스킬1(full_burst_start)은 사이클마다, 버스트(burst_cast)는 격사이클 — 둘 다 0이 아니어야 검증이 성립
    expect(skill1.length).toBeGreaterThan(1);
    expect(burst.length).toBeGreaterThan(0);
    expect(burst.length).toBeLessThan(skill1.length);
    expect(fullBursts.length).toBeGreaterThan(0);
  });

  it('유령의 장난은 유령 분장이 살아 있는 동안에만 보스에 붙는다', () => {
    const log = run(STD);
    const disguise = activations(log, '유령 분장');
    const prank = activations(log, '유령의 장난');
    expect(disguise.length).toBeGreaterThan(0);
    expect(prank.length).toBeGreaterThan(0);
    // 유령 분장 없이는 발동 불가 — 유령 분장 첫 부여보다 먼저 붙은 유령의 장난이 없어야 한다
    const firstDisguise = Math.min(...disguise.map((e: any) => e.t));
    expect(prank.every((e: any) => e.t >= firstDisguise)).toBe(true);
  });

  it('맨 오른쪽 배치에서는 우측 타겟 효과가 전부 무발동이다', () => {
    const log = run(NO_RIGHT);
    expect(activations(log, '플레이풀 리틀 위치').length).toBe(0);
    expect(activations(log, '해피 할로윈!').length).toBe(0);
    expect(activations(log, '해피 할로윈! 2').length).toBe(0);
    expect(activations(log, '트릭 오어 트릿!').length).toBe(0);
    // 자신 대상 효과(유령 분장·장난 준비)는 자리와 무관하게 돈다
    expect(activations(log, '유령 분장').length).toBeGreaterThan(0);
    // 유령 분장은 켜지므로 유령의 장난(보스 디버프)도 발동한다 — 우측만 막힌다
    expect(activations(log, '유령의 장난').length).toBeGreaterThan(0);
  });
});
