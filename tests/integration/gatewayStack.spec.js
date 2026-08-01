import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const verifier = new URL('../../scripts/verify-integrated-stack.sh', import.meta.url).pathname;
const certificateCreator = new URL(
  '../../scripts/test-support/create-test-certificate.sh',
  import.meta.url,
).pathname;
const temporaryDirectories = [];
const dockerIntegrationEnabled = process.env.RUN_DOCKER_INTEGRATION === '1';

const temporaryDirectory = async (prefix) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('integration test certificate creation', () => {
  it('creates a private matching SAN certificate only inside an empty absolute directory', async () => {
    const parent = await temporaryDirectory('subweb-certificate-parent-');
    const output = join(parent, 'certificate');
    await mkdir(output);

    const result = spawnSync(
      'sh',
      [certificateCreator, output, 'app.test', 'api.app.test'],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/BEGIN (?:RSA )?PRIVATE KEY/);
    const keyPath = join(output, 'privkey.pem');
    const certificatePath = join(output, 'fullchain.pem');
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    expect((await stat(certificatePath)).mode & 0o022).toBe(0);

    const san = spawnSync('openssl', ['x509', '-in', certificatePath, '-noout', '-text'], { encoding: 'utf8' });
    expect(san.status, san.stderr).toBe(0);
    expect(san.stdout).toContain('DNS:app.test');
    expect(san.stdout).toContain('DNS:api.app.test');

    const certificateKey = spawnSync('sh', ['-c', 'openssl x509 -in "$1" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256', 'sh', certificatePath], { encoding: 'utf8' });
    const privateKey = spawnSync('sh', ['-c', 'openssl pkey -in "$1" -pubout -outform DER | openssl dgst -sha256', 'sh', keyPath], { encoding: 'utf8' });
    expect(certificateKey.status, certificateKey.stderr).toBe(0);
    expect(privateKey.status, privateKey.stderr).toBe(0);
    expect(certificateKey.stdout).toBe(privateKey.stdout);
  });

  it.each([
    ['a relative directory', async () => ['relative-output', 'app.test', 'api.app.test']],
    ['a non-empty directory', async () => {
      const parent = await temporaryDirectory('subweb-certificate-nonempty-');
      await writeFile(join(parent, 'keep'), 'keep');
      return [parent, 'app.test', 'api.app.test'];
    }],
    ['duplicate domains', async () => {
      const parent = await temporaryDirectory('subweb-certificate-duplicate-');
      const output = join(parent, 'certificate');
      await mkdir(output);
      return [output, 'app.test', 'app.test'];
    }],
    ['a CRLF domain', async () => {
      const parent = await temporaryDirectory('subweb-certificate-crlf-');
      const output = join(parent, 'certificate');
      await mkdir(output);
      return [output, 'app.test\r\ninvalid', 'api.app.test'];
    }],
  ])('rejects %s without leaving generated material', async (_label, argumentsFactory) => {
    const args = await argumentsFactory();
    const result = spawnSync('sh', [certificateCreator, ...args], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    if (args[0].startsWith('/')) {
      await expect(readFile(join(args[0], 'privkey.pem'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(args[0], 'fullchain.pem'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('removes partial certificate material when OpenSSL fails', async () => {
    const parent = await temporaryDirectory('subweb-certificate-failure-');
    const output = join(parent, 'certificate');
    const bin = join(parent, 'bin');
    await mkdir(output);
    await mkdir(bin);
    const fakeOpenSSL = join(bin, 'openssl');
    await writeFile(fakeOpenSSL, `#!/bin/sh
key=
certificate=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -keyout) shift; key=$1 ;;
    -out) shift; certificate=$1 ;;
  esac
  shift
done
: > "$key"
: > "$certificate"
exit 1
`);
    await chmod(fakeOpenSSL, 0o700);

    const result = spawnSync(
      'sh',
      [certificateCreator, output, 'app.test', 'api.app.test'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );

    expect(result.status).not.toBe(0);
    await expect(readFile(join(output, 'privkey.pem'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(output, 'fullchain.pem'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('integrated Docker gateway stack', () => {
  it.each([
    [[]],
    [['--mode']],
    [['--mode', 'other']],
    [['--mode', 'behind-proxy', '--mode', 'direct-tls']],
    [['--mode', 'behind-proxy', '--unexpected']],
  ])('rejects invalid verifier arguments before contacting Docker: %j', (args) => {
    const result = spawnSync('sh', [verifier, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/用法/);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/docker: not found/i);
  });

  it('limits cleanup to the exact generated Compose project and its own temporary directory', async () => {
    const source = await readFile(verifier, 'utf8');

    expect(source).toContain('docker compose -p "$project_name"');
    expect(source).toContain('down --volumes --remove-orphans');
    expect(source).not.toMatch(/docker\s+(?:system|volume|network|container)\s+prune/);
    expect(source).not.toMatch(/docker\s+(?:rm|rmi)\b/);
    expect(source).not.toContain('pkill');
    expect(source).toContain('temporary_root=${TMPDIR:-/tmp}');
    expect(source).not.toContain('mktemp -d /private/tmp');
  });

  it('requires controlled evidence for each TLS rejection and probes loopback ports', async () => {
    const source = await readFile(verifier, 'utf8');

    expect(source).toContain('prepare_rejection_dependencies');
    expect(source).toContain('missing-bind');
    expect(source).toContain('gateway-log');
    expect(source).toContain('occupied-port');
    expect(source).toContain("'TLS 证书不覆盖 API_DOMAIN: api.app.test'");
    expect(source).toContain('"$wrong_san" app.test other.test');
    expect(source).toContain('tcp_connects 127.0.0.1 "$internal_port"');
    expect(source).toContain('docker_port_is_available 80');
    expect(source).toContain('docker_port_is_available 443');
    expect(source).toContain('tcp_connects 127.0.0.1 "$listener_port"');
    expect(source).not.toContain('server.listen(port');
  });

  it.skipIf(!dockerIntegrationEnabled)(
    'verifies APP, API, authorization replacement, short links, persistence, and private ports',
    () => {
      const result = spawnSync('sh', [verifier, '--mode', 'behind-proxy'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 12 * 60 * 1000,
        maxBuffer: 1024 * 1024,
      });

      expect(result.status, result.stderr).toBe(0);
      const output = `${result.stdout}\n${result.stderr}`;
      for (const marker of [
        'APP Host=通过',
        'API 转换=通过',
        '内部鉴权覆盖=通过',
        '短链创建与跳转=通过',
        'Redis 重启持久性=通过',
        '内部端口未发布=通过',
        '宿主 loopback 内部端口拒绝=通过',
      ]) {
        expect(output).toContain(marker);
      }
    },
    12 * 60 * 1000,
  );
});
