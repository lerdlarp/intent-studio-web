import { describe, expect, it } from 'vitest';
import { WEB_VERSION } from './index';

describe('web', () => {
  it('exports a version', () => expect(WEB_VERSION).toBe(1));
});
