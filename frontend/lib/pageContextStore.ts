// Module-level store for page context.
// Used by api.ts to enrich requests without React context at the API layer.
// Written to by PageContextProvider; read by api.ts and WellyCallout.

let _currentPage = "";
let _pageContext: Record<string, unknown> = {};
let _expandWelly: (() => void) | null = null;
let _prefillWelly: ((text: string) => void) | null = null;

export function setCurrentPageStore(
  page: string,
  ctx: Record<string, unknown>
) {
  _currentPage = page;
  _pageContext = ctx;
}

export function patchCurrentPageContext(patch: Record<string, unknown>) {
  _pageContext = { ..._pageContext, ...patch };
}

export function getCurrentPageContextForApi() {
  return { current_page: _currentPage, page_context: _pageContext };
}

export function registerWellyControl(
  expand: () => void,
  prefill: (text: string) => void
) {
  _expandWelly = expand;
  _prefillWelly = prefill;
}

export function expandWellyGlobal() {
  _expandWelly?.();
}

export function prefillWellyGlobal(text: string) {
  _prefillWelly?.(text);
}
