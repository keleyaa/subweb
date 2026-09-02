import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);

describe('gateway logging privacy', () => {
  it('removes the legacy Nginx log renderer', async () => {
    await expect(access(rootFile('nginx/templates/http.conf.template'))).rejects.toThrow();
    await expect(access(rootFile('scripts/render-gateway-config.sh'))).rejects.toThrow();
  });

  it('keeps secrets out of the final Gateway image definition', async () => {
    const dockerfile = await readFile(rootFile('Dockerfile'), 'utf8');

    expect(dockerfile).not.toMatch(/^(?:ARG|ENV)\s+MYURLS_API_TOKEN/m);
    expect(dockerfile).not.toContain('Bearer ');
  });
});
