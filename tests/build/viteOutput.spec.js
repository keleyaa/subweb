import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config.mjs';

describe('Vite production output', () => {
  it('writes the production bundle to the Docker-served dist directory', () => {
    expect(viteConfig.build.outDir).toBe('dist');
  });
});
