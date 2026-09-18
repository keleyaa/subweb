import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const requiredDocuments = [
  'README.md',
  'docs/architecture.md',
  'docs/deployment-integration-baseline.md',
  'docs/configuration.md',
  'docs/deployment.md',
  'docs/deployment-local.md',
  'docs/deployment-docker.md',
  'docs/deployment-nginx.md',
  'docs/deployment-vps.md',
  'docs/security.md',
  'docs/operations.md',
  'docs/third-party-sources.md',
  'docs/interface-design.md',
  'docs/remote-config-sources.md',
  'docs/maintenance.md',
  'docs/validation/docker-integration.md',
  'docs/validation/local-dev.md',
  'docs/validation/interface.md',
  'deploy/subconverter/README.md',
];

const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

function stripLinkTitle(target) {
  const trimmed = target.trim();
  if (trimmed.startsWith('<')) return trimmed.slice(1, trimmed.indexOf('>'));
  return trimmed.split(/\s+["']/u, 1)[0];
}

function localTarget(sourceFile, rawTarget) {
  const target = stripLinkTitle(rawTarget);
  if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/iu.test(target)) return null;
  const withoutFragment = decodeURIComponent(target.split('#', 1)[0]);
  return path.resolve(path.dirname(sourceFile), withoutFragment);
}

export const runtimeContractFiles = [
  ...requiredDocuments,
  '.env.example',
  '.github/workflows/docker-build-release.yml',
  '.github/workflows/local-dev.yml',
  'docs/assets/readme/subweb-hero.svg',
  'docs/assets/readme/subweb-architecture.svg',
];

export function verifyDocs({ root }) {
  const errors = [];
  for (const relativeFile of requiredDocuments) {
    const absoluteFile = path.join(root, relativeFile);
    if (!fs.existsSync(absoluteFile)) {
      errors.push(`missing document: ${relativeFile}`);
      continue;
    }
    const source = fs.readFileSync(absoluteFile, 'utf8');
    for (const match of source.matchAll(markdownLinkPattern)) {
      const target = localTarget(absoluteFile, match[1]);
      if (target && !fs.existsSync(target)) {
        errors.push(`broken link: ${relativeFile} -> ${match[1]}`);
      }
    }
  }

  const commandContractFiles = [
    'README.md',
    'docs/deployment-docker.md',
    '.github/workflows/docker-build-release.yml',
  ];
  for (const relativeFile of commandContractFiles) {
    const absoluteFile = path.join(root, relativeFile);
    if (!fs.existsSync(absoluteFile)) {
      errors.push(`missing command-contract file: ${relativeFile}`);
      continue;
    }
    const source = fs.readFileSync(absoluteFile, 'utf8');
    if (/--turnstile-secret-key(?:\s|=)(?!-stdin\b)/u.test(source)) {
      errors.push(`secret key is passed through argv: ${relativeFile}`);
    }
  }

  const requiredContracts = [
    ['docs/deployment-local.md', '--env-file .runtime/local/compose.env'],
    ['docs/validation/local-dev.md', '自动契约验证使用独立的终端和运行时'],
    ['docs/deployment-docker.md', 'Turnstile Site Key 与 Secret Key 必须由部署者提供'],
    ['docs/configuration.md', '不接受手工 `REDIS_IMAGE`、`SUBCONVERTER_IMAGE` 或 `MYURLS_IMAGE` 覆盖'],
    ['docs/architecture-prd.md', 'npm run verify:production-readiness'],
    ['docs/maintenance.md', 'npm run verify:production-readiness'],
    ['docs/validation/docker-integration.md', '仅替换 SubConverter'],
    ['docs/maintenance.md', 'Go race、Go vet、构建和 `git diff --check` 是需要另行执行'],
    ['docs/third-party-sources.md', '不提供已维护的镜像 digest 或 rollback manifest'],
    ['docs/deployment.md', 'Gateway 发布镜像由 release workflow 独立构建'],
    ['docs/deployment-docker.md', '生产命令要求 `.env` 是权限 `0600` 的普通文件'],
    ['docs/deployment-docker.md', '`./scripts/subweb.sh down` 只停止服务，不使用 `--volumes`'],
    ['docs/operations.md', 'RDB format version 15'],
    ['docs/deployment-vps.md', 'subweb-backup-verify.timer'],
    ['docs/deployment-vps.md', 'BACKUP_REMOTE_MOUNT'],
    ['docs/deployment-vps.md', 'systemctl daemon-reload'],
  ];
  for (const [relativeFile, expectedText] of requiredContracts) {
    const absoluteFile = path.join(root, relativeFile);
    if (fs.existsSync(absoluteFile) && !fs.readFileSync(absoluteFile, 'utf8').includes(expectedText)) {
      errors.push(`missing current deployment contract: ${relativeFile}`);
    }
  }

  const staleRuntimePattern = /(?:Redis\s*v?\s*8(?:\.\d+)?|redis\s*:\s*8|8\.10\.1|两个 MyUrls 服务|two MyUrls services)/iu;
  for (const relativeFile of runtimeContractFiles) {
    const source = fs.readFileSync(path.join(root, relativeFile), 'utf8');
    if (staleRuntimePattern.test(source)) {
      errors.push(`stale runtime claim: ${relativeFile}`);
    }
  }

  const architecturePrdPath = path.join(root, 'docs/architecture-prd.md');
  if (fs.existsSync(architecturePrdPath)) {
    const architecturePrd = fs.readFileSync(architecturePrdPath, 'utf8');
    if (!architecturePrd.includes('Go race、Go vet、构建和 `git diff --check` 是需要另行执行')) {
      errors.push('missing current release contract: docs/architecture-prd.md');
    }
  }

  const readmePath = path.join(root, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, 'utf8');
    for (const document of requiredDocuments.slice(1)) {
      if (!readme.includes(`](${document})`)) errors.push(`README does not link: ${document}`);
    }
    for (const unsupported of ['Caddy 部署', 'Vercel 部署', 'Cloudflare Pages 部署', 'Netlify 部署', 'Fly.io 部署']) {
      if (readme.includes(unsupported)) errors.push(`unsupported deployment claim: ${unsupported}`);
    }
    if (/docker\s+(?:pull|run)[^\n]*:latest/iu.test(readme)) {
      errors.push('README production command uses a mutable latest tag');
    }
  }
  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const errors = verifyDocs({ root });
  if (errors.length > 0) {
    for (const error of errors) console.error(`documentation error: ${error}`);
    process.exitCode = 1;
  } else {
    console.log('documentation contracts=passed');
  }
}
