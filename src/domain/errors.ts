export type Stop = 'answered' | 'needs_value' | 'needs_decision' | 'blocked' | 'spent';

export class ExplorerError extends Error {
  constructor(readonly stop: Stop, readonly code: string, message: string) {
    super(message);
    this.name = 'ExplorerError';
  }
}

export const blocked = (code: string, message: string) => new ExplorerError('blocked', code, message);
export const needsValue = (code: string, message: string) => new ExplorerError('needs_value', code, message);
export const needsDecision = (code: string, message: string) => new ExplorerError('needs_decision', code, message);
export const spent = (code: string, message: string) => new ExplorerError('spent', code, message);
