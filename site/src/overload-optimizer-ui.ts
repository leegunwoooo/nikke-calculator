/**
 * 최적옵작 창 — 캐릭터 설정의 오버로드 머리줄 「최적옵작」이 연다.
 *
 * 누르면 **창이 먼저 열린다**. 몇 판을 돌리는지·얼마나 걸릴지를 보고 나서 «계산 시작»을
 * 눌러야 돈다. 창을 열 때 지금 줄로 한 판을 먼저 재 두는데, 그 시간이 예상 시간의
 * 바탕이 되고 결과에서는 «지금 줄 대비»의 기준이 된다.
 */
import { formatDamage } from './model';
import { t, tName } from './i18n';
import { LabStopped, mapLimit, type LabRun, type LabRunner } from './deck-lab';
import {
  allocationKey, allocationLabel, allowedOptions, arrangeLines, countFor, DEFAULT_FIXED, durationLabel,
  enumerateAllocations, fastBudget, fixedAllocation, fixedLineCount, MAX_PER_OPTION, TOTAL_LINES,
  fastSearch, FAST_BEAM, fastTypical, freeOptions, isChargeWeapon, PARTS, progressOf, seedSetup,
  totalsOf, type Allocation, type OptimizerSetup,
} from './overload-optimizer';
import type { DeckState, SettingsCatalog } from './types';

/**
 * 한 번에 돌릴 수 있는 조합 수. 우월·공격력 중 하나만 풀어도(차지 무기 2,415판) 여기 안에
 * 든다. 둘 다 풀면 2만 판이 넘어(수십 분) 전수로는 돌리지 않는다.
 */
export const RUN_LIMIT = 2500;
/** 조합이 이보다 많으면 처음부터 빠른 탐색을 고른다(전수는 수 분). */
export const FAST_DEFAULT_OVER = 500;
/** 기본 줄을 이 브라우저에 기억해 두는 자리 — 늘 4우2장으로 맞추는 사람은 매번 고치지 않게. */
export const FIXED_KEY = 'nikke-overload-best-fixed-v1';

function loadFixed(): Allocation {
  try {
    const raw = JSON.parse(localStorage.getItem(FIXED_KEY) ?? 'null') as unknown;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const out: Allocation = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const count = Math.trunc(Number(value));
        if (Number.isFinite(count) && count > 0) out[key] = Math.min(MAX_PER_OPTION, count);
      }
      return out;
    }
  } catch { /* 저장소를 못 쓰면 기본값으로 */ }
  return { ...DEFAULT_FIXED };
}

function saveFixed(fixed: Allocation): void {
  try { localStorage.setItem(FIXED_KEY, JSON.stringify(fixed)); } catch { /* 못 적어도 이번 창은 그대로 쓴다 */ }
}

/** 줄 레벨 기본값. */
export const DEFAULT_LINE_LEVEL = 15;
/** 결과 표에 늘어놓는 조합 수. */
export const TOP_ROWS = 10;

export interface OptimizerDeps {
  settings: SettingsCatalog;
  run: LabRunner;
  /** 지금 띄워 둔 계산 스레드 수 — 예상 시간에 쓴다. */
  parallel: () => number;
}

export interface OptimizerContext {
  /** 계산할 덱의 사본. 창이 열린 뒤 편성을 바꿔도 이 덱으로 잰다. */
  deck: DeckState;
  deckLabel: string;
  name: string;
  weaponType?: string;
  weaponChanges?: string[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const pct = (base: number, value: number): string => {
  if (!(base > 0)) return '—';
  const diff = (value / base - 1) * 100;
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`;
};

/**
 * 지금 줄 대비 차이 — 억 단위 딜 차이와 퍼센트를 함께 적는다. 퍼센트만으로는 «그래서 얼마나 오르나»가
 * 덱마다 달라 감이 안 온다는 피드백(2026-09-27)이 있었다. 억 표기는 말에 맞춘다(`formatDamage`).
 */
const vsBase = (base: number, value: number): string => {
  const diff = value - base;
  return `${diff >= 0 ? '+' : ''}${formatDamage(diff)} (${pct(base, value)})`;
};

interface Scored { allocation: Allocation; total: number; own: number }

/** 내부 부위 키는 '팔'이지만 화면 표기는 '장갑'이다(캐릭터 설정과 같게). */
const PART_LABEL: Record<string, string> = { 머리: '머리', 몸통: '몸통', 팔: '장갑', 다리: '다리' };

export function openOverloadOptimizer(deps: OptimizerDeps, context: OptimizerContext): () => void {
  document.querySelector('[data-overload-best-modal]')?.remove();
  const steps = deps.settings.overloadSteps ?? {};
  const fields = Object.keys(deps.settings.overloadFields);
  const labelOf = (key: string): string => t(deps.settings.overloadFields[key]?.label ?? key);
  const charge = isChargeWeapon(context.weaponType, context.weaponChanges);
  const who = tName(context.name);

  const wrap = el('div', 'custom-modal ob-modal');
  wrap.dataset.overloadBestModal = context.name;
  const card = el('div', 'custom-card ob-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', t('{name} 최적옵작', { name: who }));
  const head = el('div', 'custom-head');
  head.append(el('h2', '', t('{name} · 최적옵작', { name: who })));
  const close = el('button', 'custom-close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', t('닫기'));
  head.append(close);
  card.append(head);

  card.append(el('p', 'custom-desc', t('{deck} 편성 그대로 {name}의 오버로드 12줄만 바꿔 가며 덱 총딜을 잽니다. 딜은 옵션마다 몇 줄인지로만 정해지므로(부위는 상관없음) 가능한 조합을 모두 계산해 덱 총딜이 가장 높은 조합을 찾습니다.', { deck: context.deckLabel, name: who })));
  const rules = el('ul', 'deck-lab-notes');
  for (const line of [
    t('방어력은 고르지 않습니다.'),
    t('한 부위에 같은 옵션은 한 줄뿐이라 옵션 하나는 최대 4줄입니다.'),
    charge
      ? t('차지 무기(SR·RL, 무기 변경 포함)라 차지 속도·차지 대미지도 고릅니다.')
      : t('차지 무기(SR·RL, 무기 변경 포함)가 아니라 차지 속도·차지 대미지는 고르지 않습니다.'),
    t('모든 줄을 «줄 레벨»에서 고른 한 레벨(기본 Lv15)로 가정해 계산합니다. 지금 줄도 그 레벨로 다시 재서 견주므로, 레벨 차이 없이 옵션 구성만 비교합니다.'),
    t('전투 조건은 지금 화면 값을 쓰고, 난수는 기대값으로 고정합니다.'),
  ]) rules.append(el('li', '', line));
  card.append(rules);

  // 기본 줄 — 옵션마다 최소 몇 줄을 깔고 시작할지. 처음엔 4우 4공이고, 4우3공·4우2장처럼
  // 자유롭게 바꾼다(유저 요청 2026-09-27). 남은 줄에 같은 옵션을 더 얹는 것도 후보다.
  const fixedBox = el('div', 'ob-fixed');
  fixedBox.dataset.overloadBestFixed = '';
  const fixedHead = el('div', 'ob-fixed-head');
  fixedHead.append(el('b', '', t('기본 줄')));
  const fixedSum = el('span', 'ob-fixed-sum');
  fixedSum.dataset.overloadBestFixedSum = '';
  fixedHead.append(fixedSum);
  const presetDefault = el('button', 'ob-fixed-preset', t('4우 4공'));
  presetDefault.type = 'button';
  presetDefault.dataset.overloadBestPreset = 'default';
  const presetClear = el('button', 'ob-fixed-preset', t('비우기'));
  presetClear.type = 'button';
  presetClear.dataset.overloadBestPreset = 'clear';
  fixedHead.append(presetDefault, presetClear);
  fixedBox.append(fixedHead);
  const fixedGrid = el('div', 'ob-fixed-grid');
  const fixedInputs = new Map<string, HTMLSelectElement>();
  const saved = loadFixed();
  for (const key of allowedOptions(charge)) {
    const cell = el('label', 'ob-fixed-cell');
    cell.append(el('span', '', labelOf(key)));
    const pick = el('select');
    pick.dataset.overloadBestFix = key;
    pick.setAttribute('aria-label', t('{option} 기본 줄 수', { option: labelOf(key) }));
    for (let n = 0; n <= MAX_PER_OPTION; n += 1) {
      const option = el('option', '', n === 0 ? '—' : `${n}`);
      option.value = String(n);
      pick.append(option);
    }
    pick.value = String(saved[key] ?? 0);
    cell.append(pick);
    fixedGrid.append(cell);
    fixedInputs.set(key, pick);
  }
  fixedBox.append(fixedGrid);
  fixedBox.append(el('p', 'deck-lab-notes ob-fixed-note', t('기본 줄은 먼저 깔고 남은 줄만 계산합니다. 최소치라 남은 줄에 같은 옵션을 더 얹는 것도 봅니다(3공이면 4공째도 후보).')));
  card.append(fixedBox);

  const options = el('div', 'ob-options');
  const levelBox = el('label', 'ob-check');
  levelBox.append(el('span', '', t('줄 레벨 (전부)')));
  const level = el('select');
  level.dataset.overloadBestLevel = '';
  for (let n = 1; n <= 15; n += 1) {
    const option = el('option', '', `Lv${n}`);
    option.value = String(n);
    level.append(option);
  }
  level.value = String(DEFAULT_LINE_LEVEL);
  levelBox.append(level);
  options.append(levelBox);
  // 계산 방식 — 고정을 하나라도 풀었을 때만 고른다(둘 다 고정이면 전수가 10초 남짓이다).
  const modeBox = el('label', 'ob-check');
  modeBox.append(el('span', '', t('계산 방식')));
  const mode = el('select');
  mode.dataset.overloadBestMode = '';
  const exactOption = el('option', '', t('전수 계산 (정확)'));
  exactOption.value = 'exact';
  const fastOption = el('option', '', t('빠른 탐색 (근사)'));
  fastOption.value = 'fast';
  mode.append(exactOption, fastOption);
  modeBox.append(mode);
  options.append(modeBox);
  card.append(options);

  const count = el('p', 'deck-lab-count');
  count.dataset.overloadBestCount = '';
  const more = el('p', 'deck-lab-notes ob-more');
  more.dataset.overloadBestMore = '';
  card.append(count, more);

  const actions = el('div', 'deck-copy-actions');
  const start = el('button', 'deck-copy-apply', t('계산 시작'));
  start.type = 'button';
  start.dataset.overloadBestStart = '';
  const stop = el('button', 'deck-copy-cancel', t('중지'));
  stop.type = 'button';
  stop.dataset.overloadBestStop = '';
  stop.hidden = true;
  actions.append(start, stop);
  card.append(actions);
  const bar = el('progress', 'ob-progress');
  bar.max = 100;
  bar.value = 0;
  bar.hidden = true;
  const status = el('p', 'deck-lab-status');
  status.dataset.overloadBestStatus = '';
  status.setAttribute('aria-live', 'polite');
  const output = el('div', 'deck-lab-output');
  output.dataset.overloadBestOutput = '';
  card.append(bar, status, output);
  wrap.append(card);
  document.body.append(wrap);

  let stopped = false;
  let running = false;
  /** 지금 돌고 있는 계산의 번호. 중지 뒤에 늦게 끝난 판이 상태 줄을 덮지 않게 한다. */
  let runToken = 0;
  let closed = false;
  /** 지금 줄로 잰 한 판과 걸린 시간. 예상 시간과 «지금 줄 대비»의 기준. */
  let baseline: { result: LabRun; ms: number; level: number } | null = null;
  let baselineError = '';
  /** 지금 줄의 옵션 구성 — 줄 정보가 있으면 이걸 고른 레벨로 다시 재서 기준으로 삼는다. */
  const currentAllocation = ((): Allocation | null => {
    const lines = context.deck.characters[context.name]?.overloadLines;
    if (!lines) return null;
    const out: Allocation = {};
    for (const part of PARTS) {
      for (const line of lines[part] ?? []) if (line?.option) out[line.option] = (out[line.option] ?? 0) + 1;
    }
    return Object.keys(out).length ? out : null;
  })();

  const readFixed = (): Allocation => Object.fromEntries([...fixedInputs.entries()]
    .map(([key, pick]) => [key, Number(pick.value)] as [string, number]).filter(([, n]) => n > 0));
  const setup = (): OptimizerSetup => ({ fixed: readFixed(), charge });
  const setFixed = (fixed: Allocation) => {
    for (const [key, pick] of fixedInputs) pick.value = String(Math.min(MAX_PER_OPTION, fixed[key] ?? 0));
    onFixedChange();
  };
  const estimate = (runs: number): string => {
    if (!baseline) return baselineError ? '' : t('예상 시간 재는 중…');
    const lanes = Math.max(1, deps.parallel());
    return t('예상 약 {time} (계산 스레드 {n}개 기준)', {
      time: durationLabel((Math.ceil(runs / lanes) * baseline.ms) / 1000), n: lanes,
    });
  };
  /** 기본 줄을 바꿀 때마다 계산 방식을 알맞게 다시 고른다 — 전수가 너무 길면 빠른 탐색. */
  const pickMode = () => {
    const n = countFor(setup());
    // 전수가 금방 끝나면 고를 일이 없다.
    modeBox.hidden = n <= FAST_DEFAULT_OVER;
    exactOption.disabled = n > RUN_LIMIT;
    mode.value = n <= FAST_DEFAULT_OVER ? 'exact' : 'fast';
  };
  const fastMode = (): boolean => !modeBox.hidden && mode.value === 'fast';
  const paint = () => {
    const now = setup();
    const used = fixedLineCount(now);
    const tooMany = used > TOTAL_LINES;
    const n = countFor(now);
    const over = !tooMany && n > RUN_LIMIT && !fastMode();
    const lines = TOTAL_LINES - used;
    const list = freeOptions(now).map(labelOf).join(' · ');
    fixedSum.textContent = t('{used} / {total}줄 · 남은 {left}줄 계산', { used, total: TOTAL_LINES, left: Math.max(0, lines) });
    fixedSum.classList.toggle('is-over', tooMany);
    if (tooMany) {
      count.textContent = t('기본 줄이 {used}줄이라 12줄을 넘습니다. 줄 수를 줄여 주세요.', { used });
    } else if (lines === 0) {
      count.textContent = `${t('기본 줄이 12줄을 다 채워 고를 줄이 없습니다 — 그 조합 하나만 잽니다.')} ${estimate(1)}`;
    } else if (fastMode()) {
      const seed = countFor(seedSetup(now));
      const seedLabel = allocationLabel(fixedAllocation(seedSetup(now)), labelOf) || t('기본 줄');
      const typical = fastTypical(now);
      count.textContent = `${t('조합 {n}개 — 빠른 탐색: 1단계로 {seedLabel}을 깐 조합 {seed}개를 전부 잰 뒤, 2단계로 지금까지 상위 {beam}개 조합에서 한두 줄씩 다른 옵션({list})으로 옮겨 보며 상위가 더 바뀌지 않을 때까지 찾습니다.', {
        n: n.toLocaleString('ko-KR'), seed, seedLabel, list, beam: FAST_BEAM,
      })} ${t('보통 {typ}판 이하 · 최대 {max}판 · {eta}', {
        typ: typical.toLocaleString('ko-KR'), eta: estimate(typical), max: fastBudget(now).toLocaleString('ko-KR'),
      })}`;
    } else {
      count.textContent = over
        ? t('조합 {n}개 — {max}개를 넘어 전수 계산하지 않습니다. 빠른 탐색을 쓰거나 기본 줄을 늘려 주세요.', { n: n.toLocaleString('ko-KR'), max: RUN_LIMIT.toLocaleString('ko-KR') })
        : `${t('조합 {n}개를 계산합니다 — 남은 {lines}줄을 {m}가지 옵션({list})에서 고릅니다.', {
          n: n.toLocaleString('ko-KR'), lines, m: freeOptions(now).length, list,
        })} ${estimate(n)}`;
    }
    count.classList.toggle('is-over', over || tooMany);
    const variant = (fixed: Allocation) => countFor({ fixed, charge }).toLocaleString('ko-KR');
    more.textContent = t('기본 줄이 적을수록 조합이 늘어납니다: 4우 4공 {both}개 · 4우만 {e}개 · 기본 줄 없음 {none}개', {
      both: variant(DEFAULT_FIXED), e: variant({ element_bonus: MAX_PER_OPTION }), none: variant({}),
    });
    start.disabled = running || over || tooMany || !baseline;
  };
  function onFixedChange(): void {
    saveFixed(readFixed());
    pickMode();
    paint();
  }
  for (const pick of fixedInputs.values()) pick.addEventListener('change', onFixedChange);
  presetDefault.addEventListener('click', () => setFixed(DEFAULT_FIXED));
  presetClear.addEventListener('click', () => setFixed({}));
  mode.addEventListener('change', paint);
  /** 계산 중에는 설정을 잠근다. */
  const lockInputs = (locked: boolean) => {
    for (const pick of fixedInputs.values()) pick.disabled = locked;
    presetDefault.disabled = presetClear.disabled = level.disabled = mode.disabled = locked;
  };

  const dismiss = () => {
    if (closed) return;
    closed = true;
    stopped = true;
    wrap.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !wrap.isConnected) return;
    event.stopPropagation();
    dismiss();
  };
  close.addEventListener('click', dismiss);
  wrap.addEventListener('click', (event) => { if (event.target === wrap) dismiss(); });
  document.addEventListener('keydown', onKey, true);
  stop.addEventListener('click', () => { stopped = true; stop.disabled = true; });

  const deckWith = (allocation: Allocation, lineLevel = Number(level.value)): DeckState => {
    const deck = structuredClone(context.deck);
    const own = deck.characters[context.name] ?? {};
    deck.characters[context.name] = { ...own, overload: totalsOf(allocation, steps, lineLevel, fields) };
    return deck;
  };

  // 지금 줄 — 후보와 **같은 레벨**로 다시 잰다(유저 요청 2026-09-27: 지금 옵션 Lv15 vs 바뀐 옵션 Lv15).
  // 줄 정보가 없으면(수치만 직접 넣었다) 입력된 수치 그대로 잰다.
  const currentNote = el('p', 'deck-lab-notes ob-current');
  currentNote.dataset.overloadBestCurrent = '';
  fixedBox.before(currentNote);
  const paintCurrent = () => {
    currentNote.textContent = currentAllocation
      ? t('지금 줄: {lines} — 모두 Lv{n} 기준으로 다시 재서 비교 기준으로 삼습니다.', {
        // 방어력처럼 고르지 않는 옵션도 지금 줄에는 있을 수 있다 — 설정 표 순서로 전부 적는다.
        lines: fields.filter((key) => (currentAllocation[key] ?? 0) > 0)
          .map((key) => `${labelOf(key)} ${currentAllocation[key]}`).join(' · '), n: level.value,
      })
      : t('지금 줄: 줄 단위 정보가 없어(수치만 입력) 입력된 수치 그대로 기준으로 삼습니다.');
  };
  /** 기준 판을 잰다. 레벨을 바꾸면 다시 잰다 — 늦게 온 옛 레벨 결과는 버린다. */
  const measureBaseline = () => {
    const lineLevel = Number(level.value);
    baseline = null;
    baselineError = '';
    paintCurrent();
    paint();
    const began = performance.now();
    const deck = currentAllocation ? deckWith(currentAllocation, lineLevel) : structuredClone(context.deck);
    void deps.run(deck).then((result) => {
      if (closed || Number(level.value) !== lineLevel) return;
      baseline = { result, ms: Math.max(1, performance.now() - began), level: lineLevel };
      paint();
    }, (error: unknown) => {
      if (closed || Number(level.value) !== lineLevel) return;
      baselineError = error instanceof Error ? error.message : String(error);
      status.textContent = t('계산할 수 없는 편성입니다: {msg}', { msg: baselineError });
      paint();
    });
  };
  level.addEventListener('change', () => { output.replaceChildren(); status.textContent = ''; measureBaseline(); });

  pickMode();
  measureBaseline();

  start.addEventListener('click', () => { void runAll(); });

  async function runAll(): Promise<void> {
    if (running || !baseline) return;
    const now = setup();
    const fast = fastMode();
    const allocations = fast ? [] : enumerateAllocations(now);
    if (!fast && allocations.length > RUN_LIMIT) return;
    running = true;
    const token = ++runToken;
    stopped = false;
    start.disabled = true;
    stop.hidden = false;
    stop.disabled = false;
    lockInputs(true);
    bar.hidden = false;
    bar.value = 0;
    output.replaceChildren();
    const t0 = performance.now();
    let done = 0;
    const tick = () => {
      if (token !== runToken || !running) return;
      const { percent, remainingSec } = progressOf(done, allocations.length, performance.now() - t0);
      bar.value = percent;
      status.textContent = remainingSec == null
        ? t('{p}% · {done}/{total}판', { p: percent, done, total: allocations.length })
        : t('{p}% · {done}/{total}판 · 남은 시간 약 {left}', { p: percent, done, total: allocations.length, left: durationLabel(remainingSec) });
    };
    if (fast) {
      await runFast(now, token, t0);
      return;
    }
    tick();
    try {
      const scored = await mapLimit(allocations, Math.max(1, deps.parallel()) + 1, async (allocation): Promise<Scored | null> => {
        try {
          const result = await deps.run(deckWith(allocation));
          return Number.isFinite(result.squadTotal)
            ? { allocation, total: result.squadTotal, own: result.charTotals[context.name] ?? 0 } : null;
        } catch (error) {
          if (error instanceof LabStopped) throw error;
          return null;
        } finally {
          done += 1;
          if (!closed) tick();
        }
      }, () => stopped || closed);
      if (closed) return;
      const ranked = scored.filter((entry): entry is Scored => entry !== null).sort((a, b) => b.total - a.total);
      const seconds = (performance.now() - t0) / 1000;
      bar.value = 100;
      status.textContent = t('끝났습니다 · {n}판 · {time}', { n: allocations.length, time: durationLabel(seconds) });
      render(ranked);
    } catch (error) {
      if (closed) return;
      runToken += 1;
      status.textContent = error instanceof LabStopped || stopped
        ? t('중지했습니다 ({done}/{total}판).', { done, total: allocations.length })
        : t('계산에 실패했습니다: {msg}', { msg: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
      stop.hidden = true;
      lockInputs(false);
      if (!closed) paint();
    }
  }

  /**
   * 빠른 탐색. 몇 회차에서 멈출지 미리 알 수 없어 진행 막대는 **지금 단계(회차) 기준**이다 —
   * 회차마다 잴 조합 수는 그 회차를 시작할 때 정해진다. 남은 시간도 그 단계 몫이다.
   */
  async function runFast(now: OptimizerSetup, token: number, t0: number): Promise<void> {
    const seedCount = countFor(seedSetup(now));
    const own = new Map<string, number>();
    let done = 0;
    let phaseDone = 0;
    let phaseSize = seedCount;
    let label = '';
    const tick = () => {
      if (token !== runToken || !running) return;
      const elapsed = performance.now() - t0;
      const phasePct = phaseSize > 0 ? Math.min(100, Math.floor((phaseDone / phaseSize) * 100)) : 100;
      bar.value = phasePct;
      // 한 판에 드는 시간은 지금까지 전체 평균으로 잰다 — 회차 첫머리에도 흔들리지 않는다.
      const perRun = done >= 3 ? elapsed / done : null;
      status.textContent = perRun == null
        ? t('{phase} {p}% · {d}/{n}판 · 누적 {done}판', { phase: label, p: phasePct, d: phaseDone, n: phaseSize, done })
        : t('{phase} {p}% · {d}/{n}판 · 누적 {done}판 · 이 단계 남은 시간 약 {left}', {
          phase: label, p: phasePct, d: phaseDone, n: phaseSize, done,
          left: durationLabel(((phaseSize - phaseDone) * perRun) / 1000),
        });
    };
    try {
      const result = await fastSearch(now, async (batch, phase) => {
        label = phase.stage === 1 ? t('1단계') : t('2단계 {r}회차', { r: phase.round });
        phaseDone = 0;
        phaseSize = batch.length;
        tick();
        return mapLimit(batch, Math.max(1, deps.parallel()) + 1, async (allocation) => {
          try {
            const run = await deps.run(deckWith(allocation));
            own.set(allocationKey(allocation), run.charTotals[context.name] ?? 0);
            return run.squadTotal;
          } catch (error) {
            if (error instanceof LabStopped) throw error;
            return null;
          } finally {
            done += 1;
            phaseDone += 1;
            if (!closed) tick();
          }
        }, () => stopped || closed);
      });
      if (closed) return;
      bar.value = 100;
      status.textContent = t('끝났습니다 · 빠른 탐색 {n}판 · {time}', { n: done, time: durationLabel((performance.now() - t0) / 1000) });
      render(result.ranked.map((entry) => ({ ...entry, own: own.get(allocationKey(entry.allocation)) ?? 0 })), {
        runs: done, rounds: result.rounds, converged: result.converged,
      });
    } catch (error) {
      if (closed) return;
      runToken += 1;
      status.textContent = error instanceof LabStopped || stopped
        ? t('중지했습니다 (누적 {done}판).', { done })
        : t('계산에 실패했습니다: {msg}', { msg: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
      stop.hidden = true;
      lockInputs(false);
      if (!closed) paint();
    }
  }

  function render(ranked: Scored[], fast?: { runs: number; rounds: number; converged: boolean }): void {
    const best = ranked[0];
    if (!best || !baseline) {
      output.append(el('p', 'deck-lab-muted', t('계산된 조합이 없습니다.')));
      return;
    }
    const base = baseline.result;
    const summary = el('div', 'ob-best');
    summary.dataset.overloadBestResult = '';
    summary.append(el('h3', '', currentAllocation
      ? t('최적 조합 · 모든 줄 Lv{n} (지금 줄도 같은 Lv{n} 기준)', { n: level.value })
      : t('최적 조합 · 모든 줄 Lv{n}', { n: level.value })));
    summary.append(el('p', 'ob-best-label', allocationLabel(best.allocation, labelOf)));
    const totals = el('p', 'deck-lab-summary');
    totals.append(el('b', '', t('덱 총딜 {value}', { value: formatDamage(best.total) })),
      el('span', best.total >= base.squadTotal ? 'is-up' : 'is-down', ` ${t('지금 줄 대비 {diff}', { diff: vsBase(base.squadTotal, best.total) })}`),
      el('span', 'deck-lab-muted', ` · ${t('{name} 딜 {value}', { name: who, value: formatDamage(best.own) })}`));
    summary.append(totals);
    // 부위별로 놓는 한 가지 방법 — 한 부위에 같은 옵션이 두 번 들지 않게 나눈다.
    const layout = el('ul', 'ob-layout');
    const arranged = arrangeLines(best.allocation);
    for (const part of PARTS) {
      const row = el('li');
      row.append(el('b', '', t(PART_LABEL[part] ?? part)), el('span', '', arranged[part].map(labelOf).join(' · ')));
      layout.append(row);
    }
    summary.append(layout);
    const ties = ranked.filter((entry) => Math.abs(entry.total - best.total) <= Math.abs(best.total) * 1e-7).length;
    if (ties > 1) summary.append(el('p', 'deck-lab-notes', t('덱 총딜이 똑같은 조합이 {n}개 있습니다 — 이 니케에게 효과가 없는 옵션끼리는 무엇을 넣어도 같습니다.', { n: ties })));
    if (fast) {
      const note = el('p', 'deck-lab-notes ob-fast-note');
      note.dataset.overloadBestFast = '';
      note.textContent = fast.converged
        ? t('빠른 탐색 결과입니다 — {runs}판을 쟀고, 2단계 {r}회차에서 상위 조합이 더 바뀌지 않아 멈췄습니다. 전수 계산이 아니라 드물게 더 좋은 조합을 놓칠 수 있습니다.', { runs: fast.runs, r: fast.rounds })
        : t('빠른 탐색 결과입니다 — {runs}판을 쟀고, 회차 상한({r}회차)까지 계속 나아져 거기서 멈췄습니다. 이 조합에서 한 번 더 돌리면 더 나아질 수 있습니다.', { runs: fast.runs, r: fast.rounds });
      summary.append(note);
    }
    output.append(summary);

    const list = el('ol', 'deck-lab-cases ob-rank');
    for (const [index, entry] of ranked.slice(0, TOP_ROWS).entries()) {
      const row = el('li');
      row.dataset.overloadBestRow = String(index + 1);
      const line = el('div', 'deck-lab-case-head');
      line.append(el('b', 'deck-lab-rank', `${index + 1}`), el('span', 'deck-lab-case-squad', allocationLabel(entry.allocation, labelOf)));
      const value = el('span', 'deck-lab-num');
      value.append(el('b', '', formatDamage(entry.total)));
      // 지금 줄로 잰 덱 총딜 대비 — 1위와의 차이보다 «지금보다 얼마나 오르나»가 판단에 쓰인다.
      value.append(el('span', entry.total >= base.squadTotal ? 'is-up' : 'is-down', ` ${vsBase(base.squadTotal, entry.total)}`));
      line.append(value);
      row.append(line);
      list.append(row);
    }
    output.append(el('h4', 'ob-rank-head', fast
      ? t('잰 조합 중 상위 {n}개 (지금 줄 총딜 대비)', { n: Math.min(TOP_ROWS, ranked.length) })
      : t('상위 {n}개 조합 (지금 줄 총딜 대비)', { n: Math.min(TOP_ROWS, ranked.length) })), list);
  }

  return dismiss;
}
