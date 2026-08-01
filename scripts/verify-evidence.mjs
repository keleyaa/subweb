import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedStatuses = new Set(['verified', 'designed', 'failed']);
const deploymentNames = ['docker', 'local'];

export function verifyEvidence({ root }) {
  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, 'deploy/evidence.json'), 'utf8'));
  } catch (error) {
    return [`invalid evidence manifest: ${error.message}`];
  }
  if (manifest.schemaVersion !== 1) errors.push('evidence schemaVersion must be 1');
  const deployments = manifest.deployments ?? {};
  for (const name of deploymentNames) {
    const entry = deployments[name];
    if (!entry || !allowedStatuses.has(entry.status)) {
      errors.push(`${name} evidence status is missing or invalid`);
      continue;
    }
    if (entry.status === 'failed') errors.push(`${name} evidence is failed`);
    if (entry.status === 'verified') {
      if (typeof entry.evidence !== 'string' || !fs.existsSync(path.join(root, entry.evidence))) {
        errors.push(`${name} verified evidence file is missing`);
      }
    }
    if (entry.status === 'designed' && (typeof entry.reason !== 'string' || entry.reason.length < 20)) {
      errors.push(`${name} designed status requires a concrete reason`);
    }
  }
  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const errors = verifyEvidence({ root });
  if (errors.length) {
    errors.forEach((error) => console.error(`evidence error: ${error}`));
    process.exitCode = 1;
  } else {
    console.log('deployment evidence=passed');
  }
}
