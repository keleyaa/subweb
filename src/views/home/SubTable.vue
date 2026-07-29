<template>
  <div class="row g-4 custom-div sub-table" :class="{ 'sub-table--modern': mode === 'modern' }">
    <div class="col-12 col-lg-12 pt-4 pt-lg-0">
      <div class="tab-content p-0">
        <div class="tab-pane fade show active">
          <div class="card mb-4">
            <div class="card-body">
              <div class="row mb-3 g-3">
                <fieldset class="col-12 p-0 border-0 m-0">
                  <legend class="visually-hidden">订阅输入与配置</legend>
                  <div class="row g-3">
                    <div class="col-12 col-md-12">
                      <label class="form-label" for="subscription-urls">订阅链接</label>
                      <textarea
                        class="form-control"
                        id="subscription-urls"
                        v-model.trim="urls"
                        :placeholder="placeholder"
                        rows="3"
                      ></textarea>
                    </div>
                    <div :class="mode === 'modern' ? 'col-12 col-md-6' : 'col-5 col-md-6'">
                      <label class="form-label" for="client">客户端</label>
                      <select class="form-select" id="client" v-model="target">
                        <option v-for="option in targetOptions" :key="option.value" :value="option.value">
                          {{ option.text }}
                        </option>
                      </select>
                    </div>
                    <div class="col-12 template-controls">
                      <div class="row g-3">
                        <div class="col-12 col-md-8">
                          <label class="form-label" for="template-name">本机模板名称</label>
                          <input
                            class="form-control"
                            id="template-name"
                            v-model.trim="templateName"
                            maxlength="80"
                            placeholder="保存当前客户端与参数"
                          />
                        </div>
                        <div class="col-12 col-md-4 d-flex align-items-end">
                          <button type="button" class="btn btn-outline-primary" @click="saveTemplate">保存模板</button>
                        </div>
                        <div class="col-12 col-md-6">
                          <label class="form-label" for="saved-template">已保存的本机模板</label>
                          <select class="form-select" id="saved-template" v-model="selectedTemplateId">
                            <option value="">选择模板</option>
                            <option v-for="template in templates" :key="template.id" :value="template.id">
                              {{ template.name }}
                            </option>
                          </select>
                        </div>
                        <div class="col-6 col-md-2 d-flex align-items-end">
                          <button
                            type="button"
                            class="btn btn-outline-success"
                            :disabled="!selectedTemplateId"
                            @click="applyTemplate"
                          >
                            应用
                          </button>
                        </div>
                        <div class="col-6 col-md-2 d-flex align-items-end">
                          <button
                            type="button"
                            class="btn btn-outline-danger"
                            :disabled="!selectedTemplateId"
                            @click="deleteTemplate"
                          >
                            删除
                          </button>
                        </div>
                        <div class="col-12 col-md-2 d-flex align-items-end">
                          <button
                            type="button"
                            class="btn btn-outline-secondary"
                            :disabled="templates.length === 0"
                            @click="clearTemplates"
                          >
                            清空
                          </button>
                        </div>
                      </div>
                    </div>
                    <div :class="mode === 'modern' ? 'col-12 col-md-6' : 'col-7 col-md-6'">
                      <label class="form-label" for="api">后端服务</label>
                      <select class="form-select" id="api" @change="selectApi">
                        <option :value="apiUrl">
                          {{ apiUrl }}
                        </option>
                        <option value="manual">自定义后端 API 地址</option>
                      </select>
                    </div>
                    <div class="col-12 col-md-12" v-if="isShowManualApiUrl">
                      <label class="form-label" for="manual-api-url">自定义后端 API 地址</label>
                      <input
                        class="form-control"
                        id="manual-api-url"
                        placeholder="自定义后端 API 地址示例：https://sub.ops.ci"
                        v-model="api"
                      />
                    </div>
                    <div :class="mode === 'modern' ? 'col-12 col-md-10' : 'col-8 col-md-10'">
                      <label class="form-label" for="remote">远程配置</label>
                      <select class="form-select" id="remote" @change="selectRemoteConfig">
                        <option value="">默认配置</option>
                        <option v-for="option in remoteConfigOptions" :key="option.value" :value="option.value">
                          {{ option.text }}
                        </option>
                        <option value="manual">自定义远程配置地址</option>
                      </select>
                    </div>
                    <div :class="mode === 'modern' ? 'col-12 col-md-2' : 'col-4 col-md-2'">
                      <label class="form-label" for="more-config-toggle">&nbsp;</label>
                      <button id="more-config-toggle" type="button" class="btn btn-warning" @click="showMoreConfig">
                        参数
                      </button>
                    </div>
                    <div class="col-12 col-md-12" v-if="isShowRemoteConfig">
                      <label class="form-label" for="manual-remote-config">自定义远程配置地址</label>
                      <input
                        class="form-control"
                        id="manual-remote-config"
                        placeholder="自定义远程配置地址："
                        v-model="remoteConfig"
                      />
                    </div>
                    <div class="col-12 col-md-12" v-if="isShowMoreConfig">
                      <fieldset class="border-0 p-0 m-0">
                        <legend class="visually-hidden">可选参数</legend>
                        <div class="row g-3">
                          <div class="col-12 col-md-12">
                            <label class="form-label" for="more-config-include">Include</label>
                            <input
                              class="form-control"
                              id="more-config-include"
                              placeholder="Include: 可选"
                              v-model="moreConfig.include"
                            />
                          </div>
                          <div class="col-12 col-md-12">
                            <label class="form-label" for="more-config-exclude">Exclude</label>
                            <input
                              class="form-control"
                              id="more-config-exclude"
                              placeholder="Exclude: 可选"
                              v-model="moreConfig.exclude"
                            />
                          </div>
                          <div class="col-md check-div" :style="{ display: 'flex', flexWrap: 'wrap' }">
                            <div class="form-check form-check-inline">
                              <input class="form-check-input" type="checkbox" id="emoji" v-model="moreConfig.emoji" />
                              <label class="form-check-label" for="emoji">Emoji</label>
                            </div>
                            <div class="form-check form-check-inline">
                              <input class="form-check-input" type="checkbox" id="udp" v-model="moreConfig.udp" />
                              <label class="form-check-label" for="udp">开启UDP</label>
                            </div>
                            <div class="form-check form-check-inline">
                              <input class="form-check-input" type="checkbox" id="sort" v-model="moreConfig.sort" />
                              <label class="form-check-label" for="sort">排序节点</label>
                            </div>
                            <div class="form-check form-check-inline">
                              <input class="form-check-input" type="checkbox" id="scv" v-model="moreConfig.scv" />
                              <label class="form-check-label" for="scv">关闭证书检查</label>
                            </div>
                            <div class="form-check form-check-inline">
                              <input class="form-check-input" type="checkbox" id="nodelist" v-model="moreConfig.list" />
                              <label class="form-check-label" for="nodelist">Node List</label>
                            </div>
                          </div>
                        </div>
                      </fieldset>
                    </div>
                  </div>
                </fieldset>
                <fieldset class="col-12 p-0 border-0 m-0">
                  <legend class="visually-hidden">订阅输出与操作</legend>
                  <div class="row g-3">
                    <div class="col-12 col-md-12">
                      <div class="divider divider-dashed">
                        <div class="divider-text"><i class="ti ti-refresh" style="color: gray"></i></div>
                      </div>
                    </div>
                    <div class="col-12 col-md-10">
                      <label class="form-label" for="converted-sub-url">转换结果</label>
                      <input
                        class="form-control"
                        id="converted-sub-url"
                        placeholder="点击转换链接"
                        v-model.trim="result.subUrl"
                      />
                    </div>
                    <div class="col-12 col-md-2 d-flex align-items-end">
                      <button type="button" class="btn btn-success" @click="getSubUrl()">转换</button>
                    </div>
                    <div class="col-12 col-md-10">
                      <label class="form-label" for="short-url-result">短链结果</label>
                      <input
                        class="form-control"
                        id="short-url-result"
                        placeholder="点击获取短链"
                        v-model.trim="result.shortUrl"
                      />
                    </div>
                    <div class="col-12 col-md-2 d-flex align-items-end">
                      <button type="button" class="btn btn-primary" @click="getShortUrl()">短链</button>
                    </div>
                  </div>
                </fieldset>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { showLoading, hideLoading } from '@/components/loading';
import {
  MAX_TEMPLATES,
  TARGET_OPTIONS,
  createDefaultMoreConfig,
  createTemplate,
  loadTemplates,
  normalizeMoreConfig,
  saveTemplates,
} from '@/features/templates/preferences';
import { prepareConversion, regexCheck } from './index.js';
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
      templates: [],
      templateName: '',
      selectedTemplateId: '',
    };
  },
  created() {
    this.loadLocalTemplates();
  },
  methods: {
    showTemplateStorageError() {
      this.$showDialog('error', '失败', '本机模板无法保存或读取，请检查浏览器存储设置');
    },
    loadLocalTemplates() {
      try {
        this.templates = loadTemplates(window.localStorage, () => this.showTemplateStorageError());
      } catch {
        this.templates = [];
        this.showTemplateStorageError();
      }
    },
    saveLocalTemplates(templates) {
      try {
        return saveTemplates(window.localStorage, templates, () => this.showTemplateStorageError());
      } catch {
        this.showTemplateStorageError();
        return false;
      }
    },
    createTemplateId() {
      const prefix = `template-${Date.now().toString(36)}`;
      let sequence = 0;
      let id;

      do {
        id = `${prefix}-${sequence}`;
        sequence += 1;
      } while (this.templates.some((template) => template.id === id));

      return id;
    },
    saveTemplate() {
      if (this.templates.length >= MAX_TEMPLATES) {
        this.$showDialog('warning', '注意', `本机模板最多保存 ${MAX_TEMPLATES} 条`);
        return;
      }

      const template = createTemplate(
        {
          name: this.templateName,
          target: this.target,
          moreConfig: this.moreConfig,
        },
        this.createTemplateId()
      );

      if (!template) {
        this.$showDialog('warning', '注意', '请输入不含地址的模板名称');
        return;
      }

      const nextTemplates = [...this.templates, template];
      if (!this.saveLocalTemplates(nextTemplates)) {
        return;
      }

      this.templates = nextTemplates;
      this.selectedTemplateId = template.id;
      this.templateName = '';
      showNotification('本机模板已保存', '成功');
    },
    applyTemplate() {
      const template = this.templates.find((item) => item.id === this.selectedTemplateId);
      if (!template) {
        return;
      }

      this.target = template.target;
      this.moreConfig = normalizeMoreConfig(template.moreConfig);
      this.isShowMoreConfig = true;
      showNotification('本机模板已应用', '成功');
    },
    deleteTemplate() {
      const nextTemplates = this.templates.filter((item) => item.id !== this.selectedTemplateId);
      if (nextTemplates.length === this.templates.length || !this.saveLocalTemplates(nextTemplates)) {
        return;
      }

      this.templates = nextTemplates;
      this.selectedTemplateId = '';
      showNotification('本机模板已删除', '成功');
    },
    clearTemplates() {
      if (!this.templates.length || !this.saveLocalTemplates([])) {
        return;
      }

      this.templates = [];
      this.selectedTemplateId = '';
      showNotification('本机模板已清空', '成功');
    },
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

<style scoped>
.custom-div {
  width: 100%;
  margin: 0 auto;
}
@media (min-width: 767.98px) {
  .custom-div {
    width: 90%;
    margin: 0 auto;
  }
}
@media (min-width: 991.98px) {
  .custom-div {
    width: 80%;
    margin: 0 auto;
  }
}
@media (min-width: 1199.98px) {
  .custom-div {
    width: 70%;
    margin: 0 auto;
  }
}

.btn {
  width: 100%;
}

.check-div {
  display: flex;
  justify-content: center; /* 水平居中 */
  align-items: center; /* 垂直居中 */
  height: 100%; /* 可以设置固定高度或者根据需求调整 */
}

.divider {
  margin: 1%;
}

.sub-table--modern {
  max-width: 68.75rem;
}

.sub-table--modern .card {
  border: 1px solid #d9dee7;
  box-shadow: none;
}

.sub-table--modern .card-body {
  padding: 1.25rem;
}

.sub-table--modern .form-label {
  color: #3b4350;
  font-weight: 600;
}

.sub-table--modern .form-control,
.sub-table--modern .form-select {
  max-width: 100%;
  min-width: 0;
}

.sub-table--modern .btn {
  min-height: 2.5rem;
}

.sub-table--modern .divider {
  margin: 1.25rem 0;
}

@media (min-width: 767.98px) {
  .sub-table--modern.custom-div {
    width: calc(100% - 2rem);
  }
}

@media (max-width: 575.98px) {
  .sub-table--modern.custom-div {
    max-width: 100%;
  }

  .sub-table--modern .card-body {
    padding: 1rem;
  }

  .sub-table--modern .row {
    --bs-gutter-x: 1rem;
  }
}
</style>
