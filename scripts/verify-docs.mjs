import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const requiredDocuments = [
  'README.md',
  'docs/architecture.md',
  'docs/configuration.md',
  'docs/deployment.md',
  'docs/deployment-local.md',
  'docs/deployment-docker.md',
  'docs/security.md',
  'docs/operations.md',
  'docs/third-party-sources.md',
  'docs/interface-design.md',
  'docs/remote-config-sources.md',
  'docs/maintenance.md',
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
