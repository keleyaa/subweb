import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import viteConfig from '../../vite.config.mjs';

describe('Vite production output', () => {
  it('writes the production bundle to the Docker-served dist directory', () => {
    expect(viteConfig.build.outDir).toBe('dist');
  });

  it('keeps the Docker runtime contract aligned with the Vite output directory', async () => {
    const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toContain('COPY --from=build /app/dist /usr/share/nginx/html');
  });
});
