// Modified by lazyoft: exports request compaction for the local explorer.
export { JevBrowser } from './browser.js';
export { JevDecisionEngine } from './decision.js';
export type { DecisionEngine, DecisionRequest, DecisionResult, JevOptions } from './decision.js';
export { BrowserError } from './errors.js';
export type * from './types.js';

export type { NativeCommand, NativeName } from './native-schemas.js';

export { compactDecision } from './decision-context.js';

export { estimateRequest, REQUEST_BUDGET } from './request-budget.js';
