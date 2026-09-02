import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import viteConfig from '../../vite.config.mjs';

describe('Vite production output', () => {
  it('writes the production bundle to the Docker-served dist directory', () => {
    expect(viteConfig.build.outDir).toBe('dist');
  });

  it('keeps the Docker runtime contract aligned with the Vite output directory', async () => {
    const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toMatch(/COPY --from=frontend-build --chown=65532:65532 \/app\/dist \/app\/dist/);
  });

  it('keeps secrets, private service names, and local runtime paths out of the production bundle', async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const result = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
    expect(result.status, result.stdout + '\n' + result.stderr).toBe(0);
    const outputDirectory = join(root, 'dist');
    const files = await readdir(outputDirectory, { recursive: true });
    const bundle = (
      await Promise.all(
        files
          .filter((file) => /\.(?:html|js|css)$/.test(file))
          .map((file) => readFile(join(outputDirectory, file), 'utf8'))
      )
    ).join('\n');
    for (const forbidden of [
      'MYURLS_API_TOKEN',
      'REDIS_PASSWORD',
      'myurls:8080',
      'subconverter:25500',
      'redis:6379',
      '.runtime/local',
    ]) {
      expect(bundle).not.toContain(forbidden);
    }
  });
});
