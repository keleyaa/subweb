<template>
  <section id="hero-animation" class="home-view" :class="presentation.rootClass">
    <div id="landingHero" class="section-py landing-hero position-relative">
      <div class="container">
        <div class="hero-text-box">
          <h1 class="text-primary display-6 fw-bold">{{ presentation.title }}</h1>
          <p v-if="presentation.description" class="hero-sub-title mb-0">
            {{ presentation.description }}
          </p>
        </div>
        <div class="hero-animation-img">
          <SubTable :mode="uxMode" />
        </div>
      </div>
    </div>
    <div class="landing-hero-blank"></div>
  </section>
</template>

<script>
import SubTable from './SubTable.vue';
import { getHomePresentation } from './presentation';

export default {
  name: 'SubconverterView',
  components: {
    SubTable,
  },
  data() {
    return {
      uxMode: window.config.uxMode,
    };
  },
  computed: {
    presentation() {
      return getHomePresentation(this.uxMode);
    },
  },
};
</script>

<style scoped>
.light-style .landing-hero {
  background: linear-gradient(338.18deg, #fafaff 0%, #ececec 94.44%);
}
.landing-hero .hero-animation-img {
  margin-bottom: -24rem;
}
@media (max-width: 1199.98px) {
  .landing-hero .hero-animation-img {
    margin-bottom: -18rem;
  }
}
@media (max-width: 575.98px) {
  .landing-hero .hero-animation-img {
    margin-bottom: -10rem;
  }
}

/* Landing Hero Blank */
.landing-hero-blank {
  padding-top: 20rem;
}

.home-view--legacy .hero-text-box {
  text-align: center;
}

.home-view--modern .landing-hero {
  background: #f7f8fa;
  padding-top: 2rem;
}

.home-view--modern .hero-text-box {
  max-width: 68.75rem;
  margin: 0 auto 1.5rem;
  text-align: left;
}

.home-view--modern .hero-text-box h1 {
  margin-bottom: 0.375rem;
  color: #202734 !important;
  font-size: 1.75rem;
  line-height: 1.35;
}

.home-view--modern .hero-sub-title {
  margin: 0;
  color: #626b79;
  font-size: 0.9375rem;
  line-height: 1.5;
}

.home-view--modern .hero-animation-img {
  margin-bottom: 0;
}

.home-view--modern .landing-hero-blank {
  padding-top: 2rem;
}

@media (min-width: 767.98px) {
  .home-view--modern .landing-hero {
    padding-top: 2.5rem;
  }
}

@media (max-width: 575.98px) {
  .home-view--modern .landing-hero {
    padding-top: 1.25rem;
  }

  .home-view--modern .hero-text-box {
    margin-bottom: 1.25rem;
  }

  .home-view--modern .landing-hero-blank {
    padding-top: 1.25rem;
  }
}

@media (max-width: 1199.98px) {
  .landing-hero-blank {
    padding-top: 15rem;
  }
}
@media (max-width: 575.98px) {
  .landing-hero-blank {
    padding-top: 7rem;
  }
}
</style>
