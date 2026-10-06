/**
 * 최적옵작 — 오버로드 12줄을 무엇으로 채워야 이 덱의 총딜이 가장 높은가.
 *
 * 줄의 **자리(부위)** 는 딜에 상관없다 — 엔진이 받는 값은 옵션별 합계뿐이다. 그래서
 * «옵션마다 몇 줄»만 고르면 된다. 인게임에서 한 부위에 같은 옵션은 한 줄뿐이라
 * 옵션 하나는 **최대 4줄**(부위 넷)이고, 4줄 이하라면 언제나 부위에 나눠 놓을 수 있다
 * (`arrangeLines`).
 *
 * 정하고 들어가는 것 (유저 지정 2026-09-26)
 * ---------------------------------------
 * * **방어력은 뺀다** — 딜 덱에서 아무도 쓰지 않는다.
 * * **차지 속도·차지 대미지는 차지 무기만** 본다 — 무기가 SR·RL이거나, 무기 변경으로
 *   SR·RL을 드는 니케. 나머지에게는 효과가 없다.
 * * **기본 줄**을 먼저 깐다 — 처음엔 우월 코드 4줄·공격력 4줄(많은 니케가 그렇게 맞춘다).
 *   그러면 부위마다 남는 한 줄, 곧 4줄만 고르면 된다. 기본 줄은 사람이 옵션마다 0~4줄로 바꿀
 *   수 있고(4우3공·4우2장…, 유저 요청 2026-09-27) **최소치**다 — 남은 줄에 같은 옵션을 더
 *   얹는 것도 후보다(3공이면 4공째도 본다).
 * * 모든 줄은 **같은 레벨**로 본다. 옵션 표는 레벨마다 비율이 같아 순위는 거의 안 바뀐다.
 */
import type { EquipPart } from './types';

/** 고르는 옵션(방어력 제외). 화면에 늘어놓는 순서이기도 하다. */
export const OPTIMIZER_OPTIONS = [
  'element_bonus', 'atk_pct', 'crit_rate', 'crit_dmg', 'max_ammo_pct', 'accuracy_pct',
  'charge_speed_pct', 'charge_dmg_pct',
] as const;
export const CHARGE_OPTIONS = new Set(['charge_speed_pct', 'charge_dmg_pct']);
export const PARTS: EquipPart[] = ['머리', '몸통', '팔', '다리'];
export const LINES_PER_PART = 3;
export const TOTAL_LINES = PARTS.length * LINES_PER_PART;
/** 한 옵션이 가질 수 있는 줄 — 부위마다 하나. */
export const MAX_PER_OPTION = PARTS.length;

export type Allocation = Record<string, number>;

export interface OptimizerSetup {
  /** 기본 줄 — 옵션마다 최소 몇 줄. 합이 12를 넘으면 계산하지 않는다. */
  fixed: Allocation;
  /** 차지 무기인가 — 아니면 차속·차댐을 고르지 않는다. */
  charge: boolean;
}

/** 처음 여는 기본 줄 — 우월 코드 4 · 공격력 4. */
export const DEFAULT_FIXED: Allocation = { element_bonus: MAX_PER_OPTION, atk_pct: MAX_PER_OPTION };

/** 이 니케가 고를 수 있는 옵션(차지 무기가 아니면 차속·차댐 제외). */
export const allowedOptions = (charge: boolean): string[] =>
  OPTIMIZER_OPTIONS.filter((key) => charge || !CHARGE_OPTIONS.has(key));

/** 무기가 차지 무기인가 — 기본 무기나 무기 변경으로 드는 무기 중 SR·RL이 있으면. */
export const isChargeWeapon = (weaponType: string | undefined, changes: readonly string[] = []): boolean =>
  [weaponType ?? '', ...changes].some((type) => type === 'SR' || type === 'RL');

/** 기본 줄을 고를 수 있는 옵션·0~4줄 정수로 다듬는다(0줄은 뺀다). */
export function fixedAllocation(setup: OptimizerSetup): Allocation {
  const out: Allocation = {};
  for (const key of allowedOptions(setup.charge)) {
    const count = Math.max(0, Math.min(MAX_PER_OPTION, Math.trunc(Number(setup.fixed[key]) || 0)));
    if (count > 0) out[key] = count;
  }
  return out;
}

export const fixedLineCount = (setup: OptimizerSetup): number =>
  Object.values(fixedAllocation(setup)).reduce((a, b) => a + b, 0);

/** 기본 줄 합이 12줄 안인가. */
export const fixedFits = (setup: OptimizerSetup): boolean => fixedLineCount(setup) <= TOTAL_LINES;

/** 남은 줄에 더 얹을 수 있는 옵션과 그 여유(4 − 기본 줄). */
function capsOf(setup: OptimizerSetup): Array<[string, number]> {
  const fixed = fixedAllocation(setup);
  return allowedOptions(setup.charge)
    .map((key): [string, number] => [key, MAX_PER_OPTION - (fixed[key] ?? 0)])
    .filter(([, cap]) => cap > 0);
}

/** 남은 줄에서 고를 옵션. */
export function freeOptions(setup: OptimizerSetup): string[] {
  return capsOf(setup).map(([key]) => key);
}

export function freeLines(setup: OptimizerSetup): number {
  return Math.max(0, TOTAL_LINES - fixedLineCount(setup));
}

const choose = (n: number, k: number): number => {
  if (k < 0 || n < k) return 0;
  let out = 1;
  for (let i = 1; i <= k; i += 1) out = (out * (n - k + i)) / i;
  return Math.round(out);
};

/** 옵션 n개에 줄 k개를 옵션마다 `cap`줄 이하로 나누는 방법 수(포함·배제). */
export function countAllocations(n: number, k: number, cap = MAX_PER_OPTION): number {
  if (n === 0) return k === 0 ? 1 : 0;
  let total = 0;
  for (let j = 0; j <= n && j * (cap + 1) <= k; j += 1) {
    total += (j % 2 ? -1 : 1) * choose(n, j) * choose(k - j * (cap + 1) + n - 1, n - 1);
  }
  return total;
}

/**
 * 이 설정으로 돌릴 조합 수(지금 줄로 한 번 재는 기준 판은 빼고). 옵션마다 여유가 달라
 * (기본 3줄이면 1줄만 더) 한 줄씩 쌓아 센다. 기본 줄이 12줄을 넘으면 0이다.
 */
export function countFor(setup: OptimizerSetup): number {
  if (!fixedFits(setup)) return 0;
  const lines = freeLines(setup);
  let ways: number[] = Array.from({ length: lines + 1 }, (_, k) => (k === 0 ? 1 : 0));
  for (const [, cap] of capsOf(setup)) {
    const next: number[] = Array.from({ length: lines + 1 }, () => 0);
    for (let used = 0; used <= lines; used += 1) {
      const here = ways[used] ?? 0;
      if (!here) continue;
      for (let add = 0; add <= cap && used + add <= lines; add += 1) next[used + add] = (next[used + add] ?? 0) + here;
    }
    ways = next;
  }
  return ways[lines] ?? 0;
}

/** 기본 줄 + 남은 줄 — 가능한 조합 전부. */
export function enumerateAllocations(setup: OptimizerSetup): Allocation[] {
  if (!fixedFits(setup)) return [];
  const caps = capsOf(setup);
  const fixed = fixedAllocation(setup);
  const out: Allocation[] = [];
  const pick = (index: number, left: number, acc: Allocation) => {
    if (left === 0) { out.push({ ...acc }); return; }
    if (index >= caps.length) return;
    const [key, cap] = caps[index]!;
    for (let n = Math.min(cap, left); n >= 0; n -= 1) {
      pick(index + 1, left - n, n > 0 ? { ...acc, [key]: (acc[key] ?? 0) + n } : acc);
    }
  };
  pick(0, freeLines(setup), { ...fixed });
  return out;
}

/** 조합 → 엔진이 받는 옵션별 합계. 줄은 모두 `level`이다. */
export function totalsOf(allocation: Allocation, steps: Record<string, number[]>, level: number,
  fields: string[]): Record<string, number> {
  const totals: Record<string, number> = Object.fromEntries(fields.map((key) => [key, 0]));
  for (const [key, count] of Object.entries(allocation)) {
    const table = steps[key];
    if (!table || count <= 0) continue;
    const value = table[Math.min(Math.max(1, level), table.length) - 1] ?? 0;
    totals[key] = Math.round(value * count * 1000) / 1000;
  }
  return totals;
}

/**
 * 조합을 부위 넷에 나눠 놓는다 — 옵션별로 줄을 늘어놓고 차례로 머리·몸통·팔·다리에
 * 돌려 넣으면, 한 옵션(4줄 이하)이 한 부위에 두 번 들어가는 일이 없다.
 */
export function arrangeLines(allocation: Allocation): Record<EquipPart, string[]> {
  const order = OPTIMIZER_OPTIONS.filter((key) => (allocation[key] ?? 0) > 0);
  const flat = order.flatMap((key) => Array.from({ length: allocation[key]! }, () => key));
  const out = Object.fromEntries(PARTS.map((part) => [part, [] as string[]])) as Record<EquipPart, string[]>;
  flat.forEach((key, index) => out[PARTS[index % PARTS.length]!]!.push(key));
  return out;
}

/** 조합을 사람이 읽는 줄 — «우월 4 · 공격력 4 · 크리티컬 대미지 4». */
export function allocationLabel(allocation: Allocation, labelOf: (key: string) => string): string {
  return OPTIMIZER_OPTIONS.filter((key) => (allocation[key] ?? 0) > 0)
    .map((key) => `${labelOf(key)} ${allocation[key]}`).join(' · ');
}

/** 진행 상황 — 몇 퍼센트, 남은 시간(초). 처음 몇 판은 워커가 뜨는 시간이 섞여 추정을 미룬다. */
export function progressOf(done: number, total: number, elapsedMs: number): { percent: number; remainingSec: number | null } {
  const percent = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 100;
  if (done < 3 || elapsedMs <= 0) return { percent, remainingSec: null };
  return { percent, remainingSec: Math.max(0, Math.round(((total - done) * elapsedMs) / done / 1000)) };
}

/** «약 1분 20초» · «약 8초». */
export function durationLabel(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}분 ${rest}초` : `${m}분`;
}

// ── 빠른 탐색 ────────────────────────────────────────────────────────────
// 고정을 풀면 조합이 수천~2만 개로 늘어 전수로는 수 분~수십 분이 걸린다. 그래서
//   1단계: 4우·4공 고정 조합(126·35개)을 전부 잰다 — 대부분의 답이 이 안에 있다.
//   2단계: 지금까지 가장 좋은 조합 **몇 개(빔)** 에서 한 줄 또는 두 줄을 다른 옵션으로 옮긴
//          이웃을 전부 잰다. 상위 몇 개가 더 바뀌지 않으면 멈춘다.
// 두 줄 이동을 넣은 까닭은 장탄처럼 **두 줄이 모여야 한 발이 느는** 계단 효과 때문이다 —
// 한 줄씩만 옮기면 그 계단을 못 넘는다.
// 1등 하나만 따라가면(빔 1) 크리티컬 확률·대미지처럼 **함께 올려야 값이 나는** 옵션을 놓친다 —
// 전수 결과와 견준 벤치(2026-09-26, 앨리스·레드 후드 전 조합)에서 빔 1은 3위(−0.03%)에 멈췄고
// 빔 2~3은 1위를 찾았다. 그래서 상위 3개를 함께 따라간다. 그래도 전수가 아니라 근사다.

/** 빠른 탐색 2단계의 최대 회차. 벤치에서는 3~4회차에서 멈췄다. */
export const FAST_MAX_ROUNDS = 6;
/** 2단계에서 함께 따라가는 상위 조합 수(빔 폭). */
export const FAST_BEAM = 3;

/** 조합을 가리키는 열쇠 — 옵션 순서대로 줄 수를 잇는다. */
export const allocationKey = (allocation: Allocation): string =>
  OPTIMIZER_OPTIONS.map((key) => allocation[key] ?? 0).join(',');

/**
 * 빠른 탐색 1단계의 조합 — 기본 줄에 우월·공격력 4줄을 더 깐 판(흔한 답이 모인 곳). 그렇게 깔면
 * 12줄을 넘으면 기본 줄 그대로다.
 */
export function seedSetup(setup: OptimizerSetup): OptimizerSetup {
  const fixed = fixedAllocation(setup);
  const seeded: Allocation = { ...fixed };
  for (const [key, count] of Object.entries(DEFAULT_FIXED)) seeded[key] = Math.max(seeded[key] ?? 0, count);
  const next = { ...setup, fixed: seeded };
  return fixedFits(next) ? next : { ...setup, fixed };
}

/**
 * 한 줄 또는 두 줄을 옵션 A에서 B로 옮긴 조합들. 기본 줄(`fixed`) 아래로는 빼지 않는다 —
 * 기본 줄 위에 얹힌 줄만 옮긴다.
 */
export function neighborsOf(allocation: Allocation, options: string[], fixed: Allocation = {}): Allocation[] {
  const out = new Map<string, Allocation>();
  for (const from of options) {
    for (const to of options) {
      if (from === to) continue;
      for (const move of [1, 2]) {
        const have = allocation[from] ?? 0;
        const room = MAX_PER_OPTION - (allocation[to] ?? 0);
        if (have - (fixed[from] ?? 0) < move || room < move) continue;
        const next: Allocation = { ...allocation, [to]: (allocation[to] ?? 0) + move };
        if (have === move) delete next[from];
        else next[from] = have - move;
        out.set(allocationKey(next), next);
      }
    }
  }
  return [...out.values()];
}

/** 2단계 한 회차의 최대 이웃 수 — 옵션 쌍마다 한 줄·두 줄. */
export const maxNeighbors = (optionCount: number): number => 2 * optionCount * (optionCount - 1);

/** 빠른 탐색이 돌 수 있는 최대 판 수(상한 — 이웃이 겹치고 이미 잰 것은 다시 안 재서 실제는 훨씬 적다). */
export const fastBudget = (setup: OptimizerSetup): number =>
  Math.min(countFor(setup),
    countFor(seedSetup(setup)) + FAST_MAX_ROUNDS * FAST_BEAM * maxNeighbors(freeOptions(setup).length));

/**
 * 빠른 탐색이 보통 도는 판 수(예상 시간용). 1단계 전부 + 이웃 4회차 분량 — 벤치 네 가지(앨리스·레드 후드,
 * 조합 1,751~23,940개)에서 실제로 돈 판 수(77·263·357·473)는 모두 이 안이었고 전부 전수의 1위를 찾았다.
 */
export const fastTypical = (setup: OptimizerSetup): number =>
  Math.min(fastBudget(setup), countFor(seedSetup(setup)) + 4 * maxNeighbors(freeOptions(setup).length));

export interface FastScore { allocation: Allocation; total: number }

export interface FastSearchResult {
  /** 잰 조합 전부(딜 높은 순). */
  ranked: FastScore[];
  /** 2단계를 몇 회차 돌았나. */
  rounds: number;
  /** 더 나아지지 않아 멈췄나(아니면 회차 상한에 닿았다). */
  converged: boolean;
}

/**
 * 빠른 탐색. `evaluate`는 조합 묶음을 받아 덱 총딜(실패는 null)을 같은 순서로 돌려준다 —
 * 판을 어떻게 돌리고 진행을 어떻게 알리는지는 부르는 쪽 몫이다.
 */
export async function fastSearch(
  setup: OptimizerSetup,
  evaluate: (allocations: Allocation[], phase: { stage: 1 | 2; round: number }) => Promise<Array<number | null>>,
  beam = FAST_BEAM,
): Promise<FastSearchResult> {
  const scored = new Map<string, FastScore>();
  /** 계산에 실패한 조합 — 다음 회차에 다시 돌리지 않는다. */
  const failed = new Set<string>();
  const measure = async (allocations: Allocation[], phase: { stage: 1 | 2; round: number }) => {
    const fresh = [...new Map(allocations.map((allocation) => [allocationKey(allocation), allocation])).entries()]
      .filter(([key]) => !scored.has(key) && !failed.has(key));
    if (fresh.length === 0) return;
    const totals = await evaluate(fresh.map(([, allocation]) => allocation), phase);
    fresh.forEach(([key, allocation], index) => {
      const total = totals[index];
      if (total != null && Number.isFinite(total)) scored.set(key, { allocation, total });
      else failed.add(key);
    });
  };
  const topOf = (): FastScore[] => [...scored.values()].sort((a, b) => b.total - a.total).slice(0, beam);
  const sameTop = (a: FastScore[], b: FastScore[]) =>
    a.length === b.length && a.every((entry, index) => allocationKey(entry.allocation) === allocationKey(b[index]!.allocation));

  await measure(enumerateAllocations(seedSetup(setup)), { stage: 1, round: 0 });
  let top = topOf();
  // 옮길 수 있는 옵션 — 기본 줄 위에 얹힌 줄이 있거나 여유가 있는 옵션 전부.
  const options = allowedOptions(setup.charge);
  const fixed = fixedAllocation(setup);
  let rounds = 0;
  let converged = false;
  while (top.length && rounds < FAST_MAX_ROUNDS) {
    rounds += 1;
    await measure(top.flatMap((entry) => neighborsOf(entry.allocation, options, fixed)), { stage: 2, round: rounds });
    const next = topOf();
    if (sameTop(next, top)) { converged = true; break; }
    top = next;
  }
  return { ranked: [...scored.values()].sort((a, b) => b.total - a.total), rounds, converged };
}
