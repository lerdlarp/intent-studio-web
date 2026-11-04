import { describe, expect, it } from 'vitest';
import { SCENE_VERSION } from './index';

describe('scene', () => {
  it('exports a version', () => expect(SCENE_VERSION).toBe(1));
});
