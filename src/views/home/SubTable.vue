<template>
  <form class="sub-table sub-table--modern" :data-ux-mode="mode" @submit.prevent="getSubUrl">
    <fieldset class="configuration-section">
      <legend class="visually-hidden">订阅输入与配置</legend>
      <div class="subscription-input">
        <div class="form-field">
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
          <label for="api">后端服务</label>
          <select id="api" @change="selectApi">
            <option :value="apiUrl">
              {{ apiUrl }}
            </option>
            <option value="manual">自定义后端 API 地址</option>
          </select>
          <Transition name="field-reveal">
            <div v-if="isShowManualApiUrl" class="conditional-field">
              <label for="manual-api-url">自定义后端 API 地址</label>
              <input id="manual-api-url" v-model="api" placeholder="自定义后端 API 地址示例：https://sub.ops.ci" />
            </div>
          </Transition>
        </div>

        <div class="form-field">
          <label for="remote">远程配置</label>
          <select id="remote" @change="selectRemoteConfig">
            <option value="">默认配置</option>
            <option v-for="option in remoteConfigOptions" :key="option.value" :value="option.value">
              {{ option.text }}
            </option>
            <option value="manual">自定义远程配置地址</option>
          </select>
          <Transition name="field-reveal">
            <div v-if="isShowRemoteConfig" class="conditional-field">
              <label for="manual-remote-config">自定义远程配置地址</label>
              <input id="manual-remote-config" v-model="remoteConfig" placeholder="自定义远程配置地址：" />
            </div>
          </Transition>
        </div>
      </div>
    </fieldset>

    <button
      id="more-config-toggle"
      type="button"
      class="advanced-disclosure"
      :aria-expanded="isShowMoreConfig"
      aria-controls="advanced-config"
      @click="showMoreConfig"
    >
      <span>高级参数</span>
      <span aria-hidden="true">{{ isShowMoreConfig ? '-' : '+' }}</span>
    </button>

    <Transition name="advanced-reveal">
      <fieldset v-if="isShowMoreConfig" id="advanced-config" class="advanced-config">
        <legend class="visually-hidden">高级参数</legend>
        <div class="advanced-fields-grid">
          <div class="form-field">
            <label for="more-config-include">Include</label>
            <input id="more-config-include" v-model="moreConfig.include" placeholder="Include: 可选" />
          </div>
          <div class="form-field">
            <label for="more-config-exclude">Exclude</label>
            <input id="more-config-exclude" v-model="moreConfig.exclude" placeholder="Exclude: 可选" />
          </div>
        </div>
        <div class="checkbox-group">
          <label class="checkbox-field">
            <input id="emoji" v-model="moreConfig.emoji" type="checkbox" />
            <span>Emoji</span>
          </label>
          <label class="checkbox-field">
            <input id="udp" v-model="moreConfig.udp" type="checkbox" />
            <span>开启 UDP</span>
          </label>
          <label class="checkbox-field">
            <input id="sort" v-model="moreConfig.sort" type="checkbox" />
            <span>排序节点</span>
          </label>
          <label class="checkbox-field">
            <input id="scv" v-model="moreConfig.scv" type="checkbox" />
            <span>关闭证书检查</span>
          </label>
          <label class="checkbox-field">
            <input id="nodelist" v-model="moreConfig.list" type="checkbox" />
            <span>Node List</span>
          </label>
        </div>
      </fieldset>
    </Transition>

    <div class="primary-action-row">
      <button type="submit" class="primary-action-button">转换订阅</button>
    </div>

    <fieldset class="results-section">
      <legend>转换结果</legend>
      <p class="results-status" :class="{ 'results-status--success': result.subUrl }" aria-live="polite">
        {{ result.subUrl ? '转换链接已生成' : '转换后将在此显示结果' }}
      </p>

      <div class="form-field result-field">
        <label for="converted-sub-url">转换链接</label>
        <div class="result-control-row">
          <input id="converted-sub-url" v-model.trim="result.subUrl" placeholder="点击转换订阅" />
          <button
            type="button"
            class="secondary-action-button"
            :disabled="!result.subUrl"
            @click="toCopy(result.subUrl, '订阅链接')"
          >
            复制
          </button>
          <button v-if="result.subUrl" type="button" class="secondary-action-button" @click="shareSubscription">
            分享
          </button>
        </div>
      </div>

      <div class="form-field result-field">
        <label for="short-url-result">短链</label>
        <div class="result-control-row">
          <input id="short-url-result" v-model.trim="result.shortUrl" placeholder="点击生成短链" />
          <button
            type="button"
            class="secondary-action-button"
            :disabled="!result.shortUrl"
            @click="toCopy(result.shortUrl, '短链')"
          >
            复制短链
          </button>
          <button type="button" class="secondary-action-button" @click="getShortUrl">生成短链</button>
        </div>
      </div>
    </fieldset>
  </form>
</template>

<script>
import { showLoading, hideLoading } from '@/components/loading';
import { TARGET_OPTIONS, createDefaultMoreConfig } from '@/features/conversion/options';
import { prepareConversion, regexCheck } from './index.js';
import { shareUrl } from '@/features/share/nativeShare';
import { request } from '@/network';
import showNotification from '@/components/notification';
export default {
  name: 'SubTable',
  props: {
    mode: {
      type: String,
      default: 'legacy',
    },
  },
  data() {
    return {
      placeholder: '多订阅链接或节点请确保每行一条\n支持手动使用"|"分割多链接或节点',
      targetOptions: TARGET_OPTIONS.map((option) => ({ ...option })),
      apiUrl: window.config.apiUrl,
      shortUrl: window.config.shortUrl,
      remoteConfigOptions: window.config.remoteConfigOptions,
      moreConfig: createDefaultMoreConfig(),
      isShowMoreConfig: false,
      isShowManualApiUrl: false,
      isShowRemoteConfig: false,
      result: {
        subUrl: '',
        shortUrl: '',
      },
      urls: [],
      api: window.config.apiUrl,
      target: 'clash',
      remoteConfig: '',
    };
  },
  methods: {
    showMoreConfig() {
      this.isShowMoreConfig = !this.isShowMoreConfig;
    },
    selectApi(event) {
      if (event.target.value == 'manual') {
        this.api = '';
        this.isShowManualApiUrl = true;
      } else {
        this.isShowManualApiUrl = false;
        this.api = event.target.value;
      }
    },
    selectRemoteConfig(event) {
      if (event.target.value == 'manual') {
        this.remoteConfig = '';
        this.isShowRemoteConfig = true;
      } else {
        this.isShowRemoteConfig = false;
        this.remoteConfig = event.target.value;
      }
    },
    toCopy(url, title) {
      if (!url) {
        this.$showDialog('warning', '注意', '复制失败：内容为空');
        return;
      }

      let copyInput;
      try {
        copyInput = document.createElement('input');
        copyInput.setAttribute('value', url);
        document.body.appendChild(copyInput);
        copyInput.select();

        if (!document.execCommand('copy')) {
          this.$showDialog('warning', '注意', '复制失败：浏览器不支持此操作');
          return;
        }

        showNotification(title + ' 复制成功', '成功');
      } catch {
        this.$showDialog('warning', '注意', '复制失败：请检查浏览器兼容性');
      } finally {
        if (copyInput && copyInput.parentNode) {
          copyInput.parentNode.removeChild(copyInput);
        }
      }
    },
    showConversionResult() {
      this.toCopy(this.result.subUrl, '订阅链接');
    },
    async shareSubscription() {
      const { status } = await shareUrl(this.result.subUrl);

      if (status === 'unsupported') {
        this.toCopy(this.result.subUrl, '订阅链接');
        return;
      }

      if (status === 'failed') {
        this.$showDialog('error', '失败', '分享失败，请稍后重试');
      }
    },
    getConverter() {
      const prepared = prepareConversion({
        urls: this.urls,
        api: this.api,
        apiUrl: this.apiUrl,
        target: this.target,
        remoteConfig: this.remoteConfig,
        isShowManualApiUrl: this.isShowManualApiUrl,
        isShowRemoteConfig: this.isShowRemoteConfig,
        isShowMoreConfig: this.isShowMoreConfig,
        moreConfig: this.moreConfig,
      });

      if (!prepared.ok) {
        const messages = {
          missingUrls: ['warning', '注意', '请先输入订阅链接或节点'],
          invalidRuntimeApi: ['error', '失败', '后端服务配置无效，请检查运行时配置'],
          invalidApi: ['warning', '注意', '请检查后端 API 地址，或选择默认后端服务'],
          missingRemoteConfig: ['warning', '注意', '请先输入远程配置地址，或选择默认配置'],
        };
        const [type, title, message] = messages[prepared.error];
        this.$showDialog(type, title, message);
        return false;
      }

      this.api = prepared.api;
      this.result.subUrl = prepared.subUrl;
      return true;
    },
    getSubUrl() {
      if (!this.getConverter()) {
        return;
      }
      this.showConversionResult();
    },
    async getShortUrl() {
      if (!this.getConverter()) {
        return;
      }
      if (!regexCheck(this.shortUrl)) {
        this.$showDialog('error', '失败', '短链服务配置无效，请检查运行时配置');
        return;
      }

      let data;
      try {
        data = new FormData();
        data.append('longUrl', btoa(this.result.subUrl));
      } catch {
        this.$showDialog('error', '失败', '短链生成失败，请稍后重试');
        return;
      }

      showLoading();
      try {
        const res = await request({
          method: 'post',
          url: this.shortUrl.replace(/\/$/, '') + '/short',
          header: {
            'Content-Type': 'application/form-data; charset=utf-8',
          },
          data: data,
        });

        if (!res.data || res.data.Code !== 1 || !res.data.ShortUrl) {
          this.$showDialog('error', '失败', '短链生成失败，请稍后重试');
          return;
        }

        this.result.shortUrl = res.data.ShortUrl;
        this.toCopy(this.result.shortUrl, '短链');
      } catch {
        this.$showDialog('error', '失败', '短链生成失败，请稍后重试');
      } finally {
        hideLoading();
      }
    },
  },
};
</script>

<style scoped src="./subTableModern.css"></style>
