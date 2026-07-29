import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const appBrandUrl = new URL('../../src/layouts/main/navbar/AppBrand.vue', import.meta.url);
const navMenuUrl = new URL('../../src/layouts/main/navbar/NavMenu.vue', import.meta.url);
const navBarUrl = new URL('../../src/layouts/main/navbar/NavBar.vue', import.meta.url);

describe('mobile navigation controls', () => {
  it('uses loaded icon components with stable touch-target dimensions', async () => {
    const [appBrandSource, navMenuSource, navBarSource] = await Promise.all([
      readFile(appBrandUrl, 'utf8'),
      readFile(navMenuUrl, 'utf8'),
      readFile(navBarUrl, 'utf8'),
    ]);

    expect(appBrandSource).toMatch(/import \{ Menu \} from '@element-plus\/icons-vue';/);
    expect(appBrandSource).toContain('<Menu class="mobile-menu-icon" aria-hidden="true" />');
    expect(appBrandSource).toContain('ref="menuToggle"');
    expect(appBrandSource).toContain(':aria-expanded="String(styleFacade.isCollapsed)"');
    expect(appBrandSource).toContain(":aria-label=\"styleFacade.isCollapsed ? '关闭导航' : '打开导航'\"");
    expect(appBrandSource).toMatch(/focusMenuToggle\(\)\s*\{\s*this\.\$refs\.menuToggle\?\.focus\(\);/);
    expect(appBrandSource).toMatch(/\.mobile-menu-toggle\s*\{[^}]*width:\s*32px\s*;/);
    expect(appBrandSource).toMatch(/\.mobile-menu-toggle\s*\{[^}]*height:\s*32px\s*;/);
    expect(appBrandSource).toMatch(
      /@media \(max-width: 991\.98px\)\s*\{[\s\S]*?\.mobile-menu-toggle\s*\{[^}]*display:\s*inline-flex\s*;/
    );
    expect(appBrandSource).toMatch(
      /@media \(min-width: 992px\)\s*\{[\s\S]*?\.mobile-menu-toggle\s*\{[^}]*display:\s*none\s*!important\s*;/
    );

    expect(navMenuSource).toMatch(/import \{ Close \} from '@element-plus\/icons-vue';/);
    expect(navMenuSource).toContain('<Close class="mobile-menu-icon" aria-hidden="true" />');
    expect(navMenuSource).toContain('id="navbarSupportedContent"');
    expect(navMenuSource).toContain(':inert="isMobileDrawerClosed"');
    expect(navMenuSource).toContain(':aria-hidden="String(isMobileDrawerClosed)"');
    expect(navMenuSource).toContain(':aria-expanded="String(styleFacade.isCollapsed)"');
    expect(navMenuSource).toContain('@keydown.esc.stop.prevent="closeMenu"');
    expect(navMenuSource).toContain("emits: ['close']");
    expect(navMenuSource).toContain('this.mobileViewportChangeHandler = (event) => this.updateMobileViewport(event);');
    expect(navMenuSource).toContain(
      "this.mobileViewportQuery.addEventListener('change', this.mobileViewportChangeHandler);"
    );
    expect(navMenuSource).toContain(
      "this.mobileViewportQuery?.removeEventListener('change', this.mobileViewportChangeHandler);"
    );
    expect(navMenuSource).toMatch(
      /closeMenu\(\)\s*\{[\s\S]*?this\.styleFacade\.closeMenu\(\);[\s\S]*?this\.\$emit\('close'\);/
    );
    expect(navMenuSource).toMatch(/\.mobile-menu-toggle\s*\{[^}]*width:\s*32px\s*;/);
    expect(navMenuSource).toMatch(/\.mobile-menu-toggle\s*\{[^}]*height:\s*32px\s*;/);
    expect(navMenuSource).toMatch(
      /@media \(max-width: 991\.98px\)\s*\{[\s\S]*?\.mobile-menu-toggle\s*\{[^}]*display:\s*inline-flex\s*;/
    );
    expect(navMenuSource).toMatch(
      /@media \(min-width: 992px\)\s*\{[\s\S]*?\.mobile-menu-toggle\s*\{[^}]*display:\s*none\s*!important\s*;/
    );
    expect(navMenuSource).toMatch(/\.landing-nav-menu\s*\{[^}]*position:\s*fixed\s*;/);
    expect(navMenuSource).toMatch(/\.landing-nav-menu\s*\{[^}]*z-index:\s*9999\s*;/);
    expect(navMenuSource).toMatch(/\.landing-menu-overlay\s*\{[^}]*z-index:\s*9998\s*;/);
    expect(navBarSource).toContain('<AppBrand ref="appBrand" />');
    expect(navBarSource).toContain('<NavMenu @close="focusMenuToggle" />');
    expect(navBarSource).toMatch(/focusMenuToggle\(\)\s*\{\s*this\.\$refs\.appBrand\.focusMenuToggle\(\);/);
    expect(navBarSource).toMatch(/\.navbar\.landing-navbar\s*\{[^}]*transform:\s*none\s*!important\s*;/);
  });
});
