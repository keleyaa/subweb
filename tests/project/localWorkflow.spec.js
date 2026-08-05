import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowPath = new URL('../../.github/workflows/local-source.yml', import.meta.url);
const verifierPath = new URL('../../scripts/verify-local-source.sh', import.meta.url);

describe('local source workflow contract', () => {
  it('covers both supported operating systems and always stops owned services', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('macos-15');
    expect(workflow).toContain('ubuntu-24.04');
    expect(workflow).toContain('uses: actions/setup-go@924ae3a1cded613372ab5595356fb5720e22ba16');
    expect(workflow).toContain('go-version: 1.26.5');
    expect(workflow).toContain('./scripts/local/bootstrap.sh && ./scripts/local/bootstrap.sh');
    expect(workflow).toContain('./scripts/local/start.sh');
    expect(workflow).toContain('./scripts/local/status.sh');
    expect(workflow).toContain('./scripts/verify-local-source.sh');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('./scripts/local/stop.sh');
    expect(workflow).not.toMatch(/sudo\s+.*(start|bootstrap|stop)\.sh/);
    expect(workflow).not.toContain('golang-go');
  });

  it('keeps the full local lifecycle contract in the real verifier', async () => {
    const verifier = await readFile(verifierPath, 'utf8');
    expect(verifier).toContain('订阅转换哨兵');
    expect(verifier).toContain('/short-api/short');
    expect(verifier).toContain('重启后旧短链');
    expect(verifier).toContain('六个默认端口冲突');
    expect(verifier).toContain('六个自定义端口派生');
    expect(verifier).toContain('端口未释放');
  });
});
