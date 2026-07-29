import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = fileURLToPath(new URL('../../../src/views/home/SubTable.vue', import.meta.url));

describe('SubTable configuration layout', () => {
  it('keeps conversion fields together before the local template controls', () => {
    const source = readFileSync(sourcePath, 'utf8');
    const clientIndex = source.indexOf('id="client"');
    const apiIndex = source.indexOf('id="api"');
    const remoteIndex = source.indexOf('id="remote"');
    const moreConfigIndex = source.indexOf('id="more-config-toggle"');
    const advancedConfigIndex = source.indexOf('id="more-config-include"');
    const templateControlsIndex = source.indexOf('class="col-12 template-controls"');

    expect(clientIndex).toBeGreaterThan(-1);
    expect(apiIndex).toBeGreaterThan(clientIndex);
    expect(remoteIndex).toBeGreaterThan(apiIndex);
    expect(moreConfigIndex).toBeGreaterThan(remoteIndex);
    expect(advancedConfigIndex).toBeGreaterThan(moreConfigIndex);
    expect(templateControlsIndex).toBeGreaterThan(advancedConfigIndex);

    expect(source.slice(clientIndex, apiIndex)).not.toContain('template-controls');
    expect(source.slice(remoteIndex, moreConfigIndex)).not.toContain('template-controls');
  });
});
