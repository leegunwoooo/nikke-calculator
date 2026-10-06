// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  allocationKey, arrangeLines, countAllocations, countFor, DEFAULT_FIXED, enumerateAllocations, fastBudget,
  fastSearch, freeOptions, isChargeWeapon, neighborsOf, progressOf, seedSetup, totalsOf, type Allocation,
} from './overload-optimizer';
import { FIXED_KEY, openOverloadOptimizer, RUN_LIMIT } from './overload-optimizer-ui';
import type { DeckState, SettingsCatalog } from './types';

const both = { fixed: DEFAULT_FIXED };
const onlyElement = { fixed: { element_bonus: 4 } };
const none = { fixed: {} };

describe('최적옵작 — 조합 세기', () => {
  it('4우·4공 고정이면 남은 4줄만 고른다 — 차지 무기 126개, 아니면 35개', () => {
    expect(freeOptions({ ...both, charge: true })).not.toContain('def_pct');
    expect(freeOptions({ ...both, charge: false })).not.toContain('charge_speed_pct');
    expect(countFor({ ...both, charge: true })).toBe(126);
    expect(countFor({ ...both, charge: false })).toBe(35);
  });

  it('기본 줄을 줄이면 늘어나는 수를 미리 안다', () => {
    expect(countFor({ ...onlyElement, charge: true })).toBe(2415);
    expect(countFor({ fixed: { atk_pct: 4 }, charge: true })).toBe(2415);
    expect(countFor({ ...none, charge: true })).toBe(23940);
    expect(countFor({ ...none, charge: false })).toBe(1751);
    expect(countFor({ ...none, charge: true })).toBeGreaterThan(RUN_LIMIT);
    expect(countFor({ ...onlyElement, charge: true })).toBeLessThanOrEqual(RUN_LIMIT);
  });

  it('기본 줄은 옵션마다 자유롭다 — 4우3공·4우2장, 그리고 최소치라 같은 옵션을 더 얹을 수 있다', () => {
    const fourThree = { fixed: { element_bonus: 4, atk_pct: 3 }, charge: false };
    const all = enumerateAllocations(fourThree);
    expect(all).toHaveLength(countFor(fourThree));
    for (const allocation of all) {
      expect(allocation.element_bonus).toBe(4);
      expect(allocation.atk_pct).toBeGreaterThanOrEqual(3);
    }
    // 3공이면 4공째도 후보다.
    expect(all.some((allocation) => allocation.atk_pct === 4)).toBe(true);
    const fourTwoAmmo = { fixed: { element_bonus: 4, max_ammo_pct: 2 }, charge: true };
    expect(enumerateAllocations(fourTwoAmmo).every((a) => (a.max_ammo_pct ?? 0) >= 2)).toBe(true);
    // 12줄을 넘으면 계산하지 않는다.
    expect(countFor({ fixed: { element_bonus: 4, atk_pct: 4, crit_dmg: 4, crit_rate: 4 }, charge: false })).toBe(0);
    // 차지 무기가 아니면 차속을 기본 줄로 넣어도 버린다.
    expect(countFor({ fixed: { ...DEFAULT_FIXED, charge_speed_pct: 4 }, charge: false })).toBe(35);
  });

  it('빠른 탐색 1단계는 기본 줄에 4우 4공을 더 깐 곳이다(넘치면 기본 줄 그대로)', () => {
    expect(seedSetup({ fixed: { crit_dmg: 2 }, charge: false }).fixed).toEqual({ element_bonus: 4, atk_pct: 4, crit_dmg: 2 });
    expect(seedSetup({ fixed: { crit_dmg: 4, crit_rate: 4, max_ammo_pct: 2 }, charge: false }).fixed)
      .toEqual({ crit_dmg: 4, crit_rate: 4, max_ammo_pct: 2 });
  });

  it('세는 수와 실제로 만드는 조합이 같고, 모두 12줄·옵션당 4줄 이하다', () => {
    for (const setup of [
      { ...both, charge: true }, { ...onlyElement, charge: false },
    ]) {
      const all = enumerateAllocations(setup);
      expect(all).toHaveLength(countFor(setup));
      expect(new Set(all.map((a) => JSON.stringify(a))).size).toBe(all.length);
      for (const allocation of all) {
        expect(Object.values(allocation).reduce((a, b) => a + b, 0)).toBe(12);
        expect(Math.max(...Object.values(allocation))).toBeLessThanOrEqual(4);
      }
    }
    expect(countAllocations(3, 13)).toBe(0);
  });

  it('차지 무기는 SR·RL이거나 무기 변경으로 SR·RL을 드는 니케다', () => {
    expect(isChargeWeapon('SR')).toBe(true);
    expect(isChargeWeapon('AR', ['RL'])).toBe(true);
    expect(isChargeWeapon('AR', ['SMG'])).toBe(false);
    expect(isChargeWeapon('MG')).toBe(false);
  });

  it('부위마다 같은 옵션이 두 번 들지 않게 나눈다', () => {
    const allocation: Allocation = { element_bonus: 4, atk_pct: 4, crit_dmg: 3, max_ammo_pct: 1 };
    const parts = arrangeLines(allocation);
    for (const lines of Object.values(parts)) {
      expect(lines).toHaveLength(3);
      expect(new Set(lines).size).toBe(3);
    }
  });

  it('합계는 줄 수 × 그 레벨 값이다', () => {
    const steps = { atk_pct: [1, 2, 3], crit_dmg: [10, 20, 30] };
    expect(totalsOf({ atk_pct: 4, crit_dmg: 2 }, steps, 2, ['atk_pct', 'crit_dmg', 'def_pct']))
      .toEqual({ atk_pct: 8, crit_dmg: 40, def_pct: 0 });
  });

  it('이웃은 한두 줄을 옮긴 조합이고, 기본 줄 아래로는 빼지 않고 4줄 상한을 지킨다', () => {
    const start: Allocation = { element_bonus: 4, atk_pct: 4, crit_dmg: 4 };
    const options = ['element_bonus', 'atk_pct', 'crit_rate', 'crit_dmg', 'max_ammo_pct', 'accuracy_pct'];
    const around = neighborsOf(start, options, { atk_pct: 4 });
    expect(around.length).toBeGreaterThan(0);
    for (const next of around) {
      expect(Object.values(next).reduce((a, b) => a + b, 0)).toBe(12);
      expect(next.atk_pct).toBe(4);
      expect(Math.max(...Object.values(next))).toBeLessThanOrEqual(4);
    }
    expect(around.map(allocationKey)).toContain(allocationKey({ element_bonus: 2, atk_pct: 4, crit_dmg: 4, max_ammo_pct: 2 }));
  });

  it('빠른 탐색은 1단계(4우·4공) 뒤 이웃으로 옮겨 가며, 두 줄이 모여야 느는 계단도 넘는다', async () => {
    // 우월은 줄마다 조금, 장탄은 두 줄부터 크게(계단) — 정답은 우월 2 · 장탄 4쪽이다.
    const score = (a: Allocation) => 100 + (a.element_bonus ?? 0) * 1 + (a.atk_pct ?? 0) * 3
      + ((a.max_ammo_pct ?? 0) >= 2 ? 10 : 0) + ((a.max_ammo_pct ?? 0) >= 4 ? 10 : 0) + (a.crit_dmg ?? 0) * 0.5;
    const setup = { fixed: { atk_pct: 4 }, charge: false };
    let calls = 0;
    const result = await fastSearch(setup, async (batch) => { calls += batch.length; return batch.map(score); });
    const exact = enumerateAllocations(setup).map((a) => ({ a, total: score(a) })).sort((x, y) => y.total - x.total)[0]!;
    expect(result.ranked[0]!.total).toBe(exact.total);
    expect(result.converged).toBe(true);
    expect(calls).toBeLessThan(countFor(setup));
    expect(calls).toBeLessThanOrEqual(fastBudget(setup));
  });

  it('남은 시간은 처음 몇 판 뒤부터 잰다', () => {
    expect(progressOf(1, 100, 100).remainingSec).toBeNull();
    expect(progressOf(10, 100, 1000)).toEqual({ percent: 10, remainingSec: 9 });
  });
});

describe('최적옵작 창', () => {
  afterEach(() => { document.body.replaceChildren(); localStorage.removeItem(FIXED_KEY); });
  const settings = {
    characters: {},
    overloadFields: Object.fromEntries(['element_bonus', 'atk_pct', 'crit_rate', 'crit_dmg', 'max_ammo_pct',
      'accuracy_pct', 'charge_speed_pct', 'charge_dmg_pct', 'def_pct'].map((key) => [key, { label: key }])),
    overloadSteps: Object.fromEntries(['element_bonus', 'atk_pct', 'crit_rate', 'crit_dmg', 'max_ammo_pct',
      'accuracy_pct', 'charge_speed_pct', 'charge_dmg_pct', 'def_pct'].map((key) => [key, Array.from({ length: 15 }, (_, i) => i + 1)])),
  } as unknown as SettingsCatalog;
  const deck: DeckState = { id: 1, squad: ['X', '', '', '', ''], characters: { X: { overload: {} } } };
  /** 크리티컬 대미지가 가장 값지고, 그다음이 장탄인 가짜 판. */
  const run = async (next: DeckState) => {
    const o = next.characters.X?.overload ?? {};
    const total = 1000 + 3 * (o.crit_dmg ?? 0) + 2 * (o.max_ammo_pct ?? 0) + (o.crit_rate ?? 0) + (o.element_bonus ?? 0);
    return { squadTotal: total, charTotals: { X: total } };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('창을 먼저 열어 조합 수를 보여 주고, 계산 시작을 눌러야 돈다', async () => {
    let calls = 0;
    openOverloadOptimizer({ settings, run: async (d) => { calls += 1; return run(d); }, parallel: () => 2 },
      { deck, deckLabel: '덱 1', name: 'X', weaponType: 'AR' });
    const modal = document.querySelector<HTMLElement>('[data-overload-best-modal]')!;
    await settle();
    expect(calls).toBe(1); // 지금 줄로 잰 기준 한 판(예상 시간)
    expect(modal.querySelector('[data-overload-best-count]')?.textContent).toContain('35');
    expect(modal.querySelector('[data-overload-best-more]')?.textContent).toContain('1,751');
    // 처음엔 4우 4공이 깔려 있다.
    const pick = (key: string) => modal.querySelector<HTMLSelectElement>(`[data-overload-best-fix="${key}"]`)!;
    expect(pick('element_bonus').value).toBe('4');
    expect(pick('atk_pct').value).toBe('4');
    expect(modal.querySelector('[data-overload-best-fix="charge_speed_pct"]')).toBeNull();
    expect(modal.querySelector('[data-overload-best-fixed-sum]')?.textContent).toContain('8 / 12줄');
    // 우월 기본 줄을 비우면 수가 늘어난다.
    pick('element_bonus').value = '0';
    pick('element_bonus').dispatchEvent(new Event('change'));
    expect(modal.querySelector('[data-overload-best-count]')?.textContent).toContain('320');
    modal.querySelector<HTMLButtonElement>('[data-overload-best-preset="default"]')!.click();
    expect(pick('element_bonus').value).toBe('4');

    modal.querySelector<HTMLButtonElement>('[data-overload-best-start]')!.click();
    for (let i = 0; i < 50 && !modal.querySelector('[data-overload-best-result]'); i += 1) await settle();
    expect(calls).toBe(1 + 35);
    const best = modal.querySelector('[data-overload-best-result]')!.textContent!;
    expect(best).toContain('crit_dmg 4');
    expect(best).toContain('element_bonus 4');
    expect(modal.querySelectorAll('[data-overload-best-row]')).toHaveLength(10);
    // 상위 조합의 퍼센트는 1위가 아니라 지금 줄로 잰 총딜 대비다 — 1위 줄은 요약의 «지금 줄 대비»와 같다.
    const firstPct = modal.querySelector('[data-overload-best-row="1"] .deck-lab-num span')?.textContent?.trim();
    expect(modal.querySelector('.deck-lab-summary')?.textContent).toContain(`지금 줄 대비 ${firstPct}`);
    // 억 단위 차이와 퍼센트를 함께 — «+딜 (+퍼센트%)».
    expect(firstPct).toMatch(/^\+[\d,.]+.* \(\+\d+\.\d{2}%\)$/);
    expect(modal.querySelector('.ob-rank-head')?.textContent).toContain('지금 줄 총딜 대비');
    expect(modal.querySelector('[data-overload-best-status]')?.textContent).toContain('끝났습니다');
  });

  it('지금 줄도 고른 레벨(기본 Lv15)로 다시 재서 견주고, 레벨을 바꾸면 기준을 다시 잰다', async () => {
    const seen: Array<Record<string, number>> = [];
    const lined: DeckState = { id: 1, squad: ['X', '', '', '', ''], characters: { X: {
      overload: { element_bonus: 99 },
      overloadLines: {
        머리: [{ option: 'element_bonus', level: 3 }, { option: 'atk_pct', level: 7 }, { option: 'def_pct', level: 1 }],
        몸통: [{ option: 'element_bonus', level: 15 }, { option: '', level: 10 }],
      },
    } } };
    openOverloadOptimizer({ settings, run: async (d) => { seen.push({ ...d.characters.X!.overload! }); return run(d); }, parallel: () => 1 },
      { deck: lined, deckLabel: '덱 1', name: 'X', weaponType: 'AR' });
    const modal = document.querySelector<HTMLElement>('[data-overload-best-modal]')!;
    await settle();
    expect(modal.querySelector<HTMLSelectElement>('[data-overload-best-level]')!.value).toBe('15');
    // 지금 줄 = 우월 2 · 공격력 1 · 방어력 1 을 전부 Lv15(표 값 15)로.
    expect(seen[0]).toMatchObject({ element_bonus: 30, atk_pct: 15, def_pct: 15 });
    expect(modal.querySelector('[data-overload-best-current]')?.textContent).toContain('Lv15');
    const level = modal.querySelector<HTMLSelectElement>('[data-overload-best-level]')!;
    level.value = '10';
    level.dispatchEvent(new Event('change'));
    await settle();
    expect(seen[1]).toMatchObject({ element_bonus: 20, atk_pct: 10, def_pct: 10 });
  });

  it('4우2장 같은 기본 줄을 기억하고, 12줄을 넘기면 시작을 막는다', async () => {
    openOverloadOptimizer({ settings, run, parallel: () => 1 }, { deck, deckLabel: '덱 1', name: 'X', weaponType: 'AR' });
    let modal = document.querySelector<HTMLElement>('[data-overload-best-modal]')!;
    await settle();
    const pick = (key: string) => modal.querySelector<HTMLSelectElement>(`[data-overload-best-fix="${key}"]`)!;
    pick('atk_pct').value = '0';
    pick('atk_pct').dispatchEvent(new Event('change'));
    pick('max_ammo_pct').value = '2';
    pick('max_ammo_pct').dispatchEvent(new Event('change'));
    expect(modal.querySelector('[data-overload-best-fixed-sum]')?.textContent).toContain('6 / 12줄 · 남은 6줄');
    modal.querySelector<HTMLButtonElement>('.custom-close')!.click();
    // 다시 열면 4우2장 그대로다.
    openOverloadOptimizer({ settings, run, parallel: () => 1 }, { deck, deckLabel: '덱 1', name: 'X', weaponType: 'AR' });
    modal = document.querySelector<HTMLElement>('[data-overload-best-modal]')!;
    await settle();
    expect(pick('element_bonus').value).toBe('4');
    expect(pick('atk_pct').value).toBe('0');
    expect(pick('max_ammo_pct').value).toBe('2');
    for (const key of ['crit_dmg', 'crit_rate']) {
      pick(key).value = '4';
      pick(key).dispatchEvent(new Event('change'));
    }
    expect(modal.querySelector('[data-overload-best-count]')?.textContent).toContain('12줄을 넘습니다');
    expect(modal.querySelector<HTMLButtonElement>('[data-overload-best-start]')!.disabled).toBe(true);
  });

  it('기본 줄을 모두 비우면 전수는 막고 빠른 탐색으로 돌린다', async () => {
    let calls = 0;
    openOverloadOptimizer({ settings, run: async (d) => { calls += 1; return run(d); }, parallel: () => 2 },
      { deck, deckLabel: '덱 1', name: 'X', weaponType: 'SR' });
    const modal = document.querySelector<HTMLElement>('[data-overload-best-modal]')!;
    await settle();
    const mode = modal.querySelector<HTMLSelectElement>('[data-overload-best-mode]')!;
    // 4우 4공이면 전수가 금방이라 방식을 고를 일이 없다.
    expect(mode.closest('label')!.hidden).toBe(true);
    modal.querySelector<HTMLButtonElement>('[data-overload-best-preset="clear"]')!.click();
    expect(mode.closest('label')!.hidden).toBe(false);
    expect(mode.value).toBe('fast');
    expect(mode.querySelector<HTMLOptionElement>('option[value="exact"]')!.disabled).toBe(true);
    expect(modal.querySelector('[data-overload-best-count]')?.textContent).toContain('23,940');
    const start = modal.querySelector<HTMLButtonElement>('[data-overload-best-start]')!;
    expect(start.disabled).toBe(false);
    start.click();
    for (let i = 0; i < 200 && !modal.querySelector('[data-overload-best-result]'); i += 1) await settle();
    expect(modal.querySelector('[data-overload-best-fast]')?.textContent).toContain('빠른 탐색');
    expect(calls - 1).toBeLessThan(1000);
    // 가짜 판에서는 크리티컬 대미지 4 · 장탄 4 · 크확 4가 최고다(공격력·우월은 거의 무가치).
    expect(modal.querySelector('.ob-best-label')?.textContent).toContain('crit_dmg 4');
  });
});
