<template>
  <form class="sub-table sub-table--modern" @submit.prevent="handleSubscriptionAction">

    <fieldset class="configuration-section">
      <legend class="visually-hidden">订阅输入与配置</legend>
      <div class="subscription-input">
        <div class="form-field command-url-field">
          <label for="subscription-urls">订阅链接</label>
          <textarea id="subscription-urls" v-model.trim="urls" :placeholder="placeholder" rows="3"></textarea>
        </div>
      </div>

      <div class="base-config-grid">
        <div class="form-field">
          <label for="client">客户端</label>
          <select id="client" v-model="target">
            <option v-for="option in targetOptions" :key="option.value" :value="option.value">
              {{ option.text }}
            </option>
          </select>
        </div>

        <div class="form-field">
          <label for="remote">远程配置</label>
          <select id="remote" @change="selectRemoteConfig">
            <option value="">后端默认配置</option>
            <option v-for="option in remoteConfigOptions" :key="option.value" :value="option.value">
              {{ option.text }}
            </option>
            <option value="manual">自定义远程配置地址</option>
          </select>
          <Transition name="field-reveal">
            <div v-if="isShowRemoteConfig" class="conditional-field">
              <label for="manual-remote-config">自定义远程配置地址</label>
              <input id="manual-remote-config" v-model="remoteConfig" placeholder="自定义远程配置地址" />
            </div>
          </Transition>
        </div>
      </div>
    </fieldset>

    <button
      v-if="customBackendEnabled"
      id="subscription-backend-toggle"
      type="button"
      class="settings-status-row"
      :aria-expanded="isShowServiceSettings"
      aria-controls="subscription-backend-panel"
      @click="showServiceSettings"
    >
      <span class="settings-status-label">订阅后端</span>
      <span class="settings-status-value">{{ backendStatus }}</span>
      <span class="settings-status-chevron" aria-hidden="true"></span>
    </button>

    <Transition v-if="customBackendEnabled" name="advanced-reveal" @after-leave="openPendingSettingsPanel">
      <fieldset v-if="isShowServiceSettings" id="subscription-backend-panel" class="advanced-config">
        <legend class="visually-hidden">订阅后端</legend>
        <div class="form-field">
          <label for="api">订阅后端</label>
          <select id="api" @change="selectApi">
            <option :value="apiUrl">默认后端</option>
            <option value="manual">自定义后端 API 地址</option>
          </select>
          <Transition name="field-reveal">
            <div v-if="isShowManualApiUrl" class="conditional-field">
              <label for="manual-api-url">自定义后端 API 地址</label>
              <input
                id="manual-api-url"
                v-model="api"
                placeholder="自定义后端 API 地址示例：https://converter.example.com"
              />
            </div>
          </Transition>
        </div>
      </fieldset>
    </Transition>

    <button
      id="more-config-toggle"
      type="button"
      class="settings-status-row"
      :aria-expanded="isShowMoreConfig"
      aria-controls="advanced-config-panel"
      @click="showMoreConfig"
    >
      <span class="settings-status-label">高级参数</span>
      <span class="settings-status-value">{{ advancedConfigStatus }}</span>
      <span class="settings-status-chevron" aria-hidden="true"></span>
    </button>

    <Transition name="advanced-reveal" @after-leave="openPendingSettingsPanel">
      <fieldset v-if="isShowMoreConfig" id="advanced-config-panel" class="advanced-config">
        <legend class="visually-hidden">高级参数</legend>
        <div class="advanced-fields-grid">
          <div class="form-field">
            <label for="more-config-include">Include</label>
            <input id="more-config-include" v-model="moreConfigDraft.include" placeholder="Include: 可选" />
          </div>
          <div class="form-field">
            <label for="more-config-exclude">Exclude</label>
            <input id="more-config-exclude" v-model="moreConfigDraft.exclude" placeholder="Exclude: 可选" />
          </div>
        </div>
        <div class="checkbox-group">
          <label class="checkbox-field"><input id="emoji" v-model="moreConfigDraft.emoji" type="checkbox" /><span>Emoji</span></label>
          <label class="checkbox-field"><input id="udp" v-model="moreConfigDraft.udp" type="checkbox" /><span>开启 UDP</span></label>
          <label class="checkbox-field"><input id="sort" v-model="moreConfigDraft.sort" type="checkbox" /><span>排序节点</span></label>
          <label class="checkbox-field"><input id="scv" v-model="moreConfigDraft.scv" type="checkbox" /><span>关闭证书检查</span></label>
          <label class="checkbox-field"><input id="nodelist" v-model="moreConfigDraft.list" type="checkbox" /><span>Node List</span></label>
        </div>
        <div class="advanced-config-actions">
          <button type="button" class="settings-action-button" @click="applyMoreConfig">保存高级参数</button>
          <button type="button" class="settings-action-button settings-action-button--quiet" @click="resetMoreConfig">
            重置高级参数
          </button>
        </div>
      </fieldset>
    </Transition>

    <div class="primary-action-row">
      <button type="submit" class="primary-action-button" :disabled="isSubscriptionCopying">
        {{ subscriptionActionLabel }}
      </button>
    </div>

    <Transition name="result-materialize">
      <fieldset v-if="hasCurrentSubscriptionResult" class="results-section">
        <legend>转换结果</legend>
        <p class="results-status" :class="{ 'results-status--success': copyFeedback }" aria-live="polite">
          {{ copyFeedback || '转换链接已生成' }}
        </p>
        <div class="form-field result-field">
          <label for="converted-sub-url">转换链接</label>
          <input id="converted-sub-url" :value="result.subUrl" readonly />
        </div>
        <div v-if="hasCurrentShortUrl" class="form-field result-field">
          <label for="short-url-result">短链</label>
          <input id="short-url-result" :value="result.shortUrl" readonly />
          <small v-if="result.shortUrlExpiresAt">有效期至 {{ shortUrlExpiryLabel }}</small>
        </div>
        <button
          v-if="shortLinksEnabled"
          type="button"
          class="secondary-action-button result-action-button"
          :disabled="isGeneratingShortUrl || isShortCopying || shortRateLimitSeconds > 0"
          :aria-busy="isGeneratingShortUrl"
          @click="handleShortUrlAction"
        >
          {{ shortActionLabel }}
        </button>
        <TurnstileChallenge
          v-if="shortLinksEnabled && shortChallenge"
          :key="shortChallengeKey"
          :site-key="shortChallenge.siteKey || turnstileSiteKey"
          :message="shortStatusMessage"
          @token="retryShortLink"
          @error="handleChallengeError"
        />
        <p v-else-if="shortLinksEnabled && shortStatusMessage" class="short-link-feedback" role="status" aria-live="polite">
          {{ shortStatusMessage }}
        </p>
      </fieldset>
    </Transition>
  </form>
</template>

<script>
import TurnstileChallenge from '@/components/turnstile/TurnstileChallenge.vue';
import { resolveRuntimeConfig } from '@/runtime/config';
import { copyText } from '@/features/clipboard/copy';
import { TARGET_OPTIONS, createDefaultMoreConfig } from '@/features/conversion/options';
import { createShortLinkClient } from '@/features/short-link/client';
import { createShortLinkWorkflow } from '@/features/short-link/workflow';
import {
  COPY_STATUS,
  createEmptyResultState,
  getCopyFeedback,
  getShortActionLabel,
  getSubscriptionActionLabel,
} from './actionState.js';
import {
  createConversionInputKey,
  hasCurrentConversionResult,
  hasCurrentShortUrlResult,
  matchesConversionInput,
  prepareConversion,
} from './index.js';

const runtimeConfig = resolveRuntimeConfig(window);

export default {
  name: 'SubTable',
  components: { TurnstileChallenge },
  data() {
    return {
      placeholder: '多订阅链接或节点请确保每行一条\n支持手动使用"|"分割多链接或节点',
      targetOptions: TARGET_OPTIONS.map((option) => ({ ...option })),
      apiUrl: runtimeConfig.apiUrl,
      remoteConfigOptions: runtimeConfig.remoteConfigOptions,
      shortLinksEnabled: runtimeConfig.shortLinksEnabled,
      customBackendEnabled: runtimeConfig.customBackendEnabled,
      turnstileSiteKey: runtimeConfig.turnstileSiteKey,
      moreConfig: createDefaultMoreConfig(),
      moreConfigDraft: createDefaultMoreConfig(),
      isShowServiceSettings: false,
      isShowMoreConfig: false,
      pendingSettingsPanel: null,
      isShowManualApiUrl: false,
      isShowRemoteConfig: false,
      isGeneratingShortUrl: false,
      shortLinkAbortController: null,
      shortChallenge: null,
       shortChallengeKey: 0,
       shortStatusMessage: '',
       shortRateLimitSeconds: 0,
       shortRateLimitTimer: null,
      shortLinkWorkflow: runtimeConfig.shortLinksEnabled
        ? createShortLinkWorkflow({
            client: createShortLinkClient(),
            copy: copyText,
          })
        : null,
      result: createEmptyResultState(),
      urls: '',
      api: runtimeConfig.apiUrl,
      target: 'clash',
      remoteConfig: '',
    };
  },
  computed: {
    conversionInput() {
      return {
        urls: this.urls,
        api: this.api,
        target: this.target,
        remoteConfig: this.remoteConfig,
        isShowMoreConfig: this.hasAppliedMoreConfig,
        moreConfig: this.moreConfig,
      };
    },
    hasAppliedMoreConfig() {
      const defaults = createDefaultMoreConfig();
      return Object.keys(defaults).some((key) => this.moreConfig[key] !== defaults[key]);
    },
    backendStatus() {
      return this.isShowManualApiUrl || this.api !== this.apiUrl ? '自定义后端' : '默认后端';
    },
    advancedConfigStatus() {
      return this.hasAppliedMoreConfig ? '已设置' : '未设置';
    },
    hasCurrentSubscriptionResult() {
      return hasCurrentConversionResult(this.result, this.conversionInput);
    },
    hasCurrentShortUrl() {
      return this.shortLinksEnabled && hasCurrentShortUrlResult(this.result, this.conversionInput);
    },
    isSubscriptionCopying() {
      return this.result.subscriptionCopyStatus === COPY_STATUS.COPYING;
    },
    isShortCopying() {
      return this.result.shortCopyStatus === COPY_STATUS.COPYING;
    },
    subscriptionActionLabel() {
      return getSubscriptionActionLabel({
        hasResult: this.hasCurrentSubscriptionResult,
        copyStatus: this.result.subscriptionCopyStatus,
      });
    },
     shortActionLabel() {
       if (this.shortRateLimitSeconds > 0) return `请等待 ${this.shortRateLimitSeconds} 秒`;
       return getShortActionLabel({
        hasShortUrl: this.hasCurrentShortUrl,
        copyStatus: this.result.shortCopyStatus,
        isGenerating: this.isGeneratingShortUrl,
      });
    },
    copyFeedback() {
      return (
        getCopyFeedback({ resource: '短链', copyStatus: this.result.shortCopyStatus }) ||
        getCopyFeedback({ resource: '订阅链接', copyStatus: this.result.subscriptionCopyStatus })
      );
    },
    shortUrlExpiryLabel() {
      if (!this.result.shortUrlExpiresAt) return '';
      return new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(this.result.shortUrlExpiresAt));
    },
  },
  watch: {
    conversionInput: {
      deep: true,
      handler() {
        this.shortLinkAbortController?.abort();
         if (this.shortChallenge) {
           this.shortChallenge = null;
           this.shortStatusMessage = '';
         }
         this.clearShortRateLimit();
      },
    },
  },
   beforeUnmount() {
     this.shortLinkAbortController?.abort();
     this.clearShortRateLimit();
   },
  methods: {
    showServiceSettings() {
      if (!this.customBackendEnabled) return;
      this.toggleSettingsPanel('backend');
    },
    showMoreConfig() {
      this.toggleSettingsPanel('advanced');
    },
    toggleSettingsPanel(panel) {
      if (panel === 'backend' && !this.customBackendEnabled) return;
      const isOpen = panel === 'backend' ? this.isShowServiceSettings : this.isShowMoreConfig;

      if (isOpen) {
        this.pendingSettingsPanel = null;
        this.closeSettingsPanels();
        return;
      }

      if (this.isShowServiceSettings || this.isShowMoreConfig) {
        this.pendingSettingsPanel = panel;
        this.closeSettingsPanels();
        return;
      }

      this.openSettingsPanel(panel);
    },
    closeSettingsPanels() {
      this.isShowServiceSettings = false;
      this.isShowMoreConfig = false;
    },
    openSettingsPanel(panel) {
      if (panel === 'backend') {
        this.isShowServiceSettings = true;
        return;
      }

      this.moreConfigDraft = { ...this.moreConfig };
      this.isShowMoreConfig = true;
    },
    openPendingSettingsPanel() {
      if (!this.pendingSettingsPanel) return;

      const panel = this.pendingSettingsPanel;
      this.pendingSettingsPanel = null;
      this.openSettingsPanel(panel);
    },
    selectApi(event) {
      if (!this.customBackendEnabled) {
        this.isShowManualApiUrl = false;
        this.api = this.apiUrl;
        return;
      }
      if (event.target.value === 'manual') {
        this.api = '';
        this.isShowManualApiUrl = true;
      } else {
        this.isShowManualApiUrl = false;
        this.api = event.target.value;
        this.pendingSettingsPanel = null;
        this.closeSettingsPanels();
      }
    },
    applyMoreConfig() {
      this.moreConfig = { ...this.moreConfigDraft };
      this.pendingSettingsPanel = null;
      this.closeSettingsPanels();
    },
    resetMoreConfig() {
      const defaults = createDefaultMoreConfig();
      this.moreConfig = { ...defaults };
      this.moreConfigDraft = { ...defaults };
      this.pendingSettingsPanel = null;
      this.closeSettingsPanels();
    },
    selectRemoteConfig(event) {
      if (event.target.value === 'manual') {
        this.remoteConfig = '';
        this.isShowRemoteConfig = true;
      } else {
        this.isShowRemoteConfig = false;
        this.remoteConfig = event.target.value;
      }
    },
    async copyResult(url, resource) {
      if (!url) return false;
      const statusField = resource === 'short' ? 'shortCopyStatus' : 'subscriptionCopyStatus';
      this.result[statusField] = COPY_STATUS.COPYING;
      try {
        await copyText(url);
        this.result[statusField] = COPY_STATUS.COPIED;
        return true;
      } catch {
        this.result[statusField] = COPY_STATUS.MANUAL;
        return false;
      }
    },
    async handleSubscriptionAction() {
      if (this.hasCurrentSubscriptionResult) {
        await this.copyResult(this.result.subUrl, 'subscription');
        return;
      }
      await this.getSubUrl();
    },
     async handleShortUrlAction() {
       if (
         !this.shortLinksEnabled ||
         !this.shortLinkWorkflow ||
         this.isGeneratingShortUrl ||
         this.isShortCopying ||
         this.shortRateLimitSeconds > 0
       ) return;
      if (this.hasCurrentShortUrl) {
        await this.copyResult(this.result.shortUrl, 'short');
        return;
      }
      await this.getShortUrl();
    },
    getConverter() {
      const prepared = prepareConversion({
        urls: this.urls,
        api: this.api,
        apiUrl: this.apiUrl,
        target: this.target,
        remoteConfig: this.remoteConfig,
        isShowManualApiUrl: this.isShowManualApiUrl,
        customBackendEnabled: this.customBackendEnabled,
        isShowRemoteConfig: this.isShowRemoteConfig,
        isShowMoreConfig: this.hasAppliedMoreConfig,
        moreConfig: this.moreConfig,
      });
      if (!prepared.ok) {
        const messages = {
          missingUrls: ['warning', '注意', '请先输入订阅链接或节点'],
          invalidRuntimeApi: ['error', '失败', '后端服务配置无效，请检查运行时配置'],
          invalidApi: ['warning', '注意', '请检查后端 API 地址，或选择默认后端服务'],
          missingRemoteConfig: ['warning', '注意', '请先输入远程配置地址，或选择后端默认配置'],
          invalidRemoteConfig: ['warning', '注意', '请检查远程配置地址，或选择后端默认配置'],
        };
        const [type, title, message] = messages[prepared.error];
        this.$showDialog(type, title, message);
        return false;
      }
      this.api = prepared.api;
       this.result = createEmptyResultState();
       this.shortChallenge = null;
       this.shortStatusMessage = '';
       this.clearShortRateLimit();
      this.result.subUrl = prepared.subUrl;
      this.result.conversionKey = createConversionInputKey(this.conversionInput);
      return true;
    },
    async getSubUrl() {
      if (!this.getConverter()) return;
      await this.copyResult(this.result.subUrl, 'subscription');
    },
    async getShortUrl(challengeToken) {
      if (!this.shortLinksEnabled || !this.shortLinkWorkflow) return;
      if (!this.hasCurrentSubscriptionResult && !this.getConverter()) return;
      const requestConversionKey = this.result.conversionKey;
      const requestSubUrl = this.result.subUrl;
      const abortController = new AbortController();
      this.shortLinkAbortController?.abort();
      this.shortLinkAbortController = abortController;
      this.isGeneratingShortUrl = true;
      this.result.shortCopyStatus = COPY_STATUS.IDLE;
      this.shortStatusMessage = '';
      try {
        const outcome = await this.shortLinkWorkflow.execute({
          url: requestSubUrl,
          conversionKey: requestConversionKey,
          challengeToken,
          isCurrent: (conversionKey) => matchesConversionInput(conversionKey, this.conversionInput),
          signal: abortController.signal,
        });
        if (outcome.kind === 'stale') return;
        if (outcome.kind === 'challenge') {
          this.shortChallenge = outcome.challenge;
          this.shortStatusMessage = outcome.message;
          this.shortChallengeKey += 1;
          return;
        }
         if (outcome.kind === 'error') {
           this.shortChallenge = null;
           if (outcome.code === 'rate_limited' && Number.isInteger(outcome.retryAfterSeconds) && outcome.retryAfterSeconds > 0) {
             this.startShortRateLimit(outcome.retryAfterSeconds);
             this.shortStatusMessage = `短链请求过于频繁，请在 ${outcome.retryAfterSeconds} 秒后重试。`;
           } else {
             this.shortStatusMessage = outcome.message;
           }
           return;
         }

         this.clearShortRateLimit();
         this.shortChallenge = null;
        this.result.shortUrl = outcome.result.shortUrl;
        this.result.shortUrlExpiresAt = outcome.result.expiresAt;
        this.result.shortUrlConversionKey = requestConversionKey;
        this.result.shortCopyStatus = outcome.copied ? COPY_STATUS.COPIED : COPY_STATUS.MANUAL;
      } finally {
        if (this.shortLinkAbortController === abortController) {
          this.shortLinkAbortController = null;
          this.isGeneratingShortUrl = false;
        }
      }
    },
     startShortRateLimit(seconds) {
       this.clearShortRateLimit();
       this.shortRateLimitSeconds = Math.ceil(seconds);
       this.shortRateLimitTimer = setInterval(() => {
         if (this.shortRateLimitSeconds <= 1) {
           this.clearShortRateLimit();
           return;
         }
         this.shortRateLimitSeconds -= 1;
       }, 1000);
     },
     clearShortRateLimit() {
       if (this.shortRateLimitTimer !== null) clearInterval(this.shortRateLimitTimer);
       this.shortRateLimitTimer = null;
       this.shortRateLimitSeconds = 0;
     },
     retryShortLink(token) {
       if (!this.shortLinksEnabled) return;
       void this.getShortUrl(token);
     },
    handleChallengeError() {
      if (!this.shortLinksEnabled) return;
      this.shortStatusMessage = '验证服务暂时不可用，请稍后重试。';
      this.shortChallenge = null;
    },
  },
};
</script>

<style scoped src="./subTableModern.css"></style>
