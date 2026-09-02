import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);

describe('SubConverter runtime drift detection', () => {
  it('compares the image-bundled and runtime-volume pref.example.toml digests without touching the volume', async () => {
    const script = await readFile(rootFile('scripts/verify-subconverter-runtime.sh'), 'utf8');

    // 通过一次性容器读取镜像自带文件，避免运行卷遮蔽镜像内容。
    expect(script).toContain('docker run --rm --entrypoint sh "$image"');
    expect(script).toContain('/base/pref.example.toml');
    // 运行卷内容从运行容器读取，不直接操作宿主机卷路径。
    expect(script).toContain('docker compose exec -T subconverter');
    expect(script).toContain('sha256sum');
    // 不一致时给出可执行的修复指引而非仅报错。
    expect(script).toContain('subconverter-runtime volume');
    expect(script).not.toContain('docker volume rm');
    expect(script).not.toContain('docker compose down');
  });

  it('is exercised by the integrated stack verifier on a fresh stack', async () => {
    const verifier = await readFile(rootFile('scripts/verify-redis-operations.sh'), 'utf8');

    expect(verifier).toContain('subconverter_runs_as_101');
    expect(verifier).toContain('Unified Redis backup, restore, and service recovery verification passed.');
  });
});
