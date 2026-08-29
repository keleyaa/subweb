<template>
  <main id="converter" class="command-surface" aria-labelledby="conversion-title">
    <section class="command-surface__center">
      <div class="command-card">
        <header class="command-card__header">
          <div class="command-card__title">
            <p>Online subscription conversion</p>
            <h1 id="conversion-title">在线订阅转换</h1>
          </div>
          <span class="command-card__shortcut" aria-hidden="true">⌘ Enter</span>
        </header>
        <SubTable />
      </div>
    </section>
  </main>
</template>

<script>
import SubTable from './SubTable.vue';

export default {
  name: 'HomeView',
  components: {
    SubTable,
  },
};
</script>

<style scoped>
.command-surface {
  display: flex;
  flex: 1;
  min-height: 0;
}

.command-surface__center {
  display: flex;
  width: 100%;
  max-width: 860px;
  margin: auto;
  align-items: center;
}

.command-card {
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: 0 30px 80px rgb(0 0 0 / 32%);
}

.command-card__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  padding: 28px 30px 23px;
  border-bottom: 1px solid var(--line);
}

.command-card__title {
  grid-column: 2;
}

.command-card__title p,
.command-card__title h1 {
  margin: 0;
}

.command-card__title p {
  margin-bottom: 5px;
  color: var(--accent);
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.command-card__title h1 {
  color: var(--text-primary);
  font-size: 26px;
  text-align: center;
  font-weight: 650;
  letter-spacing: 0;
}

.command-card__shortcut {
  grid-column: 3;
  justify-self: end;
  padding: 5px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}

@media (max-width: 640px) {
  .command-surface__center {
    align-items: flex-start;
  }

  .command-card__header {
    grid-template-columns: 1fr;
    padding: 22px 20px 18px;
  }

  .command-card__title h1 {
    font-size: 22px;
  }

  .command-card__title {
    grid-column: 1;
  }

  .command-card__shortcut {
    display: none;
  }
}
</style>
