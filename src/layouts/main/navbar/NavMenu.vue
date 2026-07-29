<template>
  <a
    v-if="githubItem"
    :href="githubItem.link"
    :target="githubItem.target"
    class="minimal-nav-link"
    rel="noopener noreferrer"
  >
    {{ githubItem.title }}
  </a>
</template>

<script>
export default {
  name: 'NavMenu',
  data() {
    return {
      navBarItem: window.config.menuItem,
    };
  },
  computed: {
    githubItem() {
      return this.navBarItem.find((item) => /github/i.test(`${item.title} ${item.link}`)) || null;
    },
  },
};
</script>

<style scoped>
.minimal-nav-link {
  display: inline-flex;
  min-height: 44px;
  padding: 0 4px;
  align-items: center;
  color: #424245;
  font-size: 14px;
  text-decoration: none;
}

.minimal-nav-link:hover,
.minimal-nav-link:focus-visible {
  color: #06c;
}

.minimal-nav-link:focus-visible {
  border-radius: 4px;
  outline: 3px solid rgba(0, 102, 204, 0.24);
  outline-offset: 2px;
}
</style>
