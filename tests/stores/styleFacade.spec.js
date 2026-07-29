import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import vuexStore from '@/store';
import { useStyleFacadeStore } from '@/stores/styleFacade';

describe('style facade', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vuexStore.commit('MAIN_LAYOUT_MENU_EXPAND_CLOSE');
    vuexStore.commit('MAIN_LAYOUT_NAV_ACTIVE', false);
  });

  it('forwards menu expansion to Vuex without owning duplicate state', () => {
    const facade = useStyleFacadeStore();

    facade.toggleMenu();

    expect(vuexStore.state.style.main.isCollapsed).toBe(true);
    expect(facade.isCollapsed).toBe(true);
    expect(facade.$state).toEqual({});
  });

  it('reflects direct Vuex navigation state changes without a state copy', () => {
    const facade = useStyleFacadeStore();

    vuexStore.commit('MAIN_LAYOUT_NAV_ACTIVE', true);

    expect(facade.navStyles).toEqual(['navbar-active']);
    expect(facade.$state).toEqual({});
  });
});
