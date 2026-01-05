import { App, PluginSettingTab, Setting, Modal, TextComponent } from 'obsidian';
import FocusPlannerPlugin from './main';
import { EventCategory, CATEGORY_LABELS } from './types';

// Modal for entering OAuth authorization code
class AuthCodeModal extends Modal {
  private code: string = '';
  private onSubmit: (code: string) => void;

  constructor(app: App, onSubmit: (code: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: '输入飞书授权码' });

    contentEl.createEl('p', {
      text: '请在浏览器中完成飞书登录后，从跳转的 URL 中复制 code 参数的值。',
      cls: 'setting-item-description',
    });

    contentEl.createEl('p', {
      text: '例如: http://localhost:3000/callback?code=abc123&state=xxx',
      cls: 'setting-item-description',
    });

    contentEl.createEl('p', {
      text: '复制 abc123 这部分（code= 后面到 & 之前的内容）',
      cls: 'setting-item-description',
    });

    new Setting(contentEl)
      .setName('授权码 (code)')
      .addText((text) => {
        text
          .setPlaceholder('粘贴授权码...')
          .onChange((value) => {
            this.code = value.trim();
          });
        text.inputEl.style.width = '300px';
      });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('取消')
          .onClick(() => {
            this.close();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText('确认')
          .setCta()
          .onClick(() => {
            if (this.code) {
              this.onSubmit(this.code);
              this.close();
            }
          })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class FocusPlannerSettingTab extends PluginSettingTab {
  plugin: FocusPlannerPlugin;

  constructor(app: App, plugin: FocusPlannerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Focus Planner 设置' });

    // Feishu section
    containerEl.createEl('h3', { text: '飞书日历同步' });

    new Setting(containerEl)
      .setName('启用飞书同步')
      .setDesc('从飞书日历自动同步日程到 Obsidian')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.feishu.syncEnabled)
          .onChange(async (value) => {
            this.plugin.settings.feishu.syncEnabled = value;
            await this.plugin.saveSettings();
            this.display(); // Refresh to show/hide sync method options
          })
      );

    // Only show sync settings if enabled
    if (this.plugin.settings.feishu.syncEnabled) {
      new Setting(containerEl)
        .setName('使用 CalDAV 同步（推荐）')
        .setDesc('CalDAV 能正确处理重复日程，需要在飞书设置中生成 CalDAV 密码')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.feishu.useCalDav)
            .onChange(async (value) => {
              this.plugin.settings.feishu.useCalDav = value;
              await this.plugin.saveSettings();
              this.display(); // Refresh to show appropriate settings
            })
        );

      new Setting(containerEl)
        .setName('同步间隔')
        .setDesc('自动同步的间隔时间（分钟）')
        .addSlider((slider) =>
          slider
            .setLimits(5, 60, 5)
            .setValue(this.plugin.settings.feishu.syncInterval)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.feishu.syncInterval = value;
              await this.plugin.saveSettings();
            })
        );

      if (this.plugin.settings.feishu.useCalDav) {
        // CalDAV settings
        containerEl.createEl('h4', { text: 'CalDAV 配置' });

        containerEl.createEl('p', {
          text: '在飞书桌面端：设置 → 日历 → CalDAV 同步 → 选择设备 → 生成',
          cls: 'setting-item-description',
        });

        new Setting(containerEl)
          .setName('CalDAV 用户名')
          .setDesc('飞书生成的 CalDAV 用户名')
          .addText((text) =>
            text
              .setPlaceholder('输入用户名...')
              .setValue(this.plugin.settings.feishu.caldavUsername || '')
              .onChange(async (value) => {
                this.plugin.settings.feishu.caldavUsername = value;
                await this.plugin.saveSettings();
              })
          );

        new Setting(containerEl)
          .setName('CalDAV 密码')
          .setDesc('飞书生成的 CalDAV 密码')
          .addText((text) => {
            text
              .setPlaceholder('输入密码...')
              .setValue(this.plugin.settings.feishu.caldavPassword || '')
              .onChange(async (value) => {
                this.plugin.settings.feishu.caldavPassword = value;
                await this.plugin.saveSettings();
              });
            text.inputEl.type = 'password';
          });

        // Status indicator
        const caldavStatus = this.plugin.settings.feishu.caldavUsername &&
                             this.plugin.settings.feishu.caldavPassword;
        new Setting(containerEl)
          .setName('状态')
          .setDesc(caldavStatus ? '✓ CalDAV 已配置' : '⚠ 请填写用户名和密码');

      } else {
        // Open API settings
        containerEl.createEl('h4', { text: 'Open API 配置' });

        new Setting(containerEl)
          .setName('App ID')
          .setDesc('飞书开放平台应用的 App ID')
          .addText((text) =>
            text
              .setPlaceholder('cli_xxxxx')
              .setValue(this.plugin.settings.feishu.appId)
              .onChange(async (value) => {
                this.plugin.settings.feishu.appId = value;
                await this.plugin.saveSettings();
              })
          );

        new Setting(containerEl)
          .setName('App Secret')
          .setDesc('飞书开放平台应用的 App Secret')
          .addText((text) =>
            text
              .setPlaceholder('xxxxx')
              .setValue(this.plugin.settings.feishu.appSecret)
              .onChange(async (value) => {
                this.plugin.settings.feishu.appSecret = value;
                await this.plugin.saveSettings();
              })
          );

        // Login button
        const loginSetting = new Setting(containerEl)
          .setName('飞书登录')
          .setDesc(
            this.plugin.settings.feishu.accessToken
              ? '已登录 ✓'
              : '点击登录飞书账号以同步日历'
          )
          .addButton((button) =>
            button
              .setButtonText('1. 打开授权页面')
              .onClick(async () => {
                await this.plugin.loginFeishu();
              })
          )
          .addButton((button) =>
            button
              .setButtonText('2. 输入授权码')
              .setCta()
              .onClick(() => {
                new AuthCodeModal(this.app, async (code) => {
                  await this.plugin.handleAuthCode(code);
                  this.display(); // Refresh settings UI
                }).open();
              })
          );

        // Show logout button if already logged in
        if (this.plugin.settings.feishu.accessToken) {
          loginSetting.addButton((button) =>
            button
              .setButtonText('退出登录')
              .setWarning()
              .onClick(async () => {
                this.plugin.settings.feishu.accessToken = '';
                this.plugin.settings.feishu.refreshToken = '';
                this.plugin.settings.feishu.tokenExpiry = 0;
                this.plugin.settings.feishu.calendarId = '';
                await this.plugin.saveSettings();
                this.display(); // Refresh settings UI
              })
          );
        }
      }
    }

    // Daily note settings
    containerEl.createEl('h3', { text: '日报设置' });

    new Setting(containerEl)
      .setName('日报路径格式')
      .setDesc('日报文件的路径格式，支持 YYYY, MM, DD 变量')
      .addText((text) =>
        text
          .setPlaceholder('0. PeriodicNotes/YYYY/Daily/MM/YYYY-MM-DD.md')
          .setValue(this.plugin.settings.dailyNotePath)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotePath = value;
            await this.plugin.saveSettings();
          })
      );

    // Pomodoro settings
    containerEl.createEl('h3', { text: '番茄钟设置' });

    new Setting(containerEl)
      .setName('番茄钟时长')
      .setDesc('每个番茄钟的分钟数')
      .addSlider((slider) =>
        slider
          .setLimits(15, 45, 5)
          .setValue(this.plugin.settings.pomodoroMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.pomodoroMinutes = value;
            await this.plugin.saveSettings();
          })
      );

    // Category keywords
    containerEl.createEl('h3', { text: '事件分类关键词' });
    containerEl.createEl('p', {
      text: '根据事件标题中的关键词自动分类，多个关键词用逗号分隔',
      cls: 'setting-item-description',
    });

    for (const category of Object.values(EventCategory)) {
      new Setting(containerEl)
        .setName(CATEGORY_LABELS[category])
        .addTextArea((text) =>
          text
            .setPlaceholder('关键词1, 关键词2, ...')
            .setValue(this.plugin.settings.categoryKeywords[category].join(', '))
            .onChange(async (value) => {
              this.plugin.settings.categoryKeywords[category] = value
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              await this.plugin.saveSettings();
            })
        );
    }

    // Display settings
    containerEl.createEl('h3', { text: '显示设置' });

    new Setting(containerEl)
      .setName('显示统计面板')
      .setDesc('在日历视图旁边显示周统计数据')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStatsPanel)
          .onChange(async (value) => {
            this.plugin.settings.showStatsPanel = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
