export const VIEW_ROUTES = {
  calc: '/calculator', union: '/union-raid', enikk: '/enikk', links: '/links',
} as const;
export const UTILITY_ROUTES = {
  pickups: '/utilities/pickups', skills: '/utilities/skills', lab: '/utilities/overload',
  mcp: '/utilities/mcp', vision: '/utilities/visualizer',
} as const;
export type ViewName = keyof typeof VIEW_ROUTES | 'fun';
export type FunView = keyof typeof UTILITY_ROUTES;
export function viewHash(view: ViewName, utility: FunView = 'skills'): string {
  return '#' + (view === 'fun' ? UTILITY_ROUTES[utility] : VIEW_ROUTES[view]);
}
export function parseViewHash(hash: string): { view: ViewName; utility?: FunView; guide?: boolean } {
  const path = hash.slice(1).replace(/\/$/, '');
  // 옵작 가이드는 캐릭터 설정 안의 대화상자라 독립 화면이 없다 — 계산기 위에 띄운다.
  if (path === '/utilities/overload-guide') return { view: 'calc', guide: true };
  for (const [view, route] of Object.entries(VIEW_ROUTES)) {
    if (path === route) return { view: view as keyof typeof VIEW_ROUTES };
  }
  for (const [utility, route] of Object.entries(UTILITY_ROUTES)) {
    if (path === route) return { view: 'fun', utility: utility as FunView };
  }
  if (path === '/utilities') return { view: 'fun', utility: 'skills' };
  return { view: 'calc' };
}
