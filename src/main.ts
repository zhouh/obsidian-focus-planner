import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import {
  FocusPlannerSettings,
  DEFAULT_SETTINGS,
  CalendarEvent,
  WeeklyStats,
  EventCategory,
} from './types';
import { FeishuApi } from './feishuApi';
import { CalDavClient } from './caldavClient';
import { DailyNoteParser } from './dailyNoteParser';
import { StatsManager } from './statsManager';
import { FocusPlannerView, VIEW_TYPE_FOCUS_PLANNER, NewEventData } from './calendarView';
import { FocusPlannerSettingTab } from './settingsTab';
import { TaskParser, TaskPanelData, ParsedTask } from './taskParser';
import { FloatingTimerWindow } from './floatingTimer';

export default class FocusPlannerPlugin extends Plugin {
  settings: FocusPlannerSettings;
  feishuApi: FeishuApi;
  caldavClient: CalDavClient;
  dailyNoteParser: DailyNoteParser;
  statsManager: StatsManager;
  taskParser: TaskParser;
  floatingTimer: FloatingTimerWindow;

  private syncIntervalId: number | null = null;
  private timerUpdateIntervalId: number | null = null;

  async onload() {
    await this.loadSettings();

    // Initialize components
    this.dailyNoteParser = new DailyNoteParser(this.app, this.settings);
    this.statsManager = new StatsManager(this.app, this.settings, this.dailyNoteParser);
    this.taskParser = new TaskParser(this.app);
    this.floatingTimer = new FloatingTimerWindow();
    this.feishuApi = new FeishuApi(
      this.settings.feishu,
      async (feishuSettings) => {
        this.settings.feishu = feishuSettings;
        await this.saveSettings();
      }
    );
    this.caldavClient = new CalDavClient(
      this.settings.feishu,
      this.settings.categoryKeywords
    );

    // Register view
    this.registerView(
      VIEW_TYPE_FOCUS_PLANNER,
      (leaf) => {
        const view = new FocusPlannerView(leaf);
        view.onSyncFeishu = () => this.syncFeishuCalendar();
        view.getWeeklyStats = (weekStart) => this.statsManager.getWeeklyStats(weekStart);
        view.onEventClick = (event) => this.handleEventClick(event);
        view.onStartPomodoro = (event) => this.startPomodoroForEvent(event);
        view.onEventUpdate = (event, newStart, newEnd) => this.handleEventUpdate(event, newStart, newEnd);
        view.onEventCreate = (data) => this.handleEventCreate(data);
        view.onEventDelete = (event) => this.handleEventDelete(event);
        view.onWeekChange = (weekStart) => this.getEventsForWeek(weekStart);
        view.onGetTasks = (weekStart) => this.taskParser.getTasksForPanel(weekStart);
        view.onTaskInferCategory = (task) => this.taskParser.inferCategory(task);
        return view;
      }
    );

    // Add ribbon icon
    this.addRibbonIcon('calendar-clock', 'Focus Planner', () => {
      this.activateView();
    });

    // Add commands
    this.addCommand({
      id: 'open-focus-planner',
      name: 'Open Focus Planner',
      callback: () => {
        this.activateView();
      },
    });

    this.addCommand({
      id: 'sync-feishu-calendar',
      name: 'Sync Feishu Calendar',
      callback: async () => {
        await this.syncFeishuCalendar();
      },
    });

    // Add settings tab
    this.addSettingTab(new FocusPlannerSettingTab(this.app, this));

    // Start auto-sync if enabled
    this.startAutoSync();

    // Load view on startup if it was open
    this.app.workspace.onLayoutReady(() => {
      this.initializeView();
    });
  }

  onunload() {
    this.stopAutoSync();
    this.stopTimerUpdate();
    this.floatingTimer?.hide();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);

    // Update components with new settings
    if (this.dailyNoteParser) {
      this.dailyNoteParser.updateSettings(this.settings);
    }
    if (this.statsManager) {
      this.statsManager.updateSettings(this.settings);
    }
    if (this.feishuApi) {
      this.feishuApi.updateSettings(this.settings.feishu);
    }
    if (this.caldavClient) {
      this.caldavClient.updateSettings(this.settings.feishu, this.settings.categoryKeywords);
    }

    // Restart auto-sync with new interval
    this.startAutoSync();
  }

  // Activate the Focus Planner view
  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_FOCUS_PLANNER);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_FOCUS_PLANNER,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
      await this.refreshView();
    }
  }

  // Initialize view with current data
  private async initializeView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOCUS_PLANNER);
    if (leaves.length > 0) {
      await this.refreshView();
    }
  }

  // Get events for a specific week
  async getEventsForWeek(weekStart: Date): Promise<CalendarEvent[]> {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    return await this.statsManager.getEventsWithProgress(weekStart, weekEnd);
  }

  // Refresh view with latest events
  async refreshView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOCUS_PLANNER);
    if (leaves.length === 0) return;

    const view = leaves[0].view as FocusPlannerView;

    // Get the week that the view is currently displaying
    const weekStart = view.getCurrentWeekStart();

    // Get events for that week
    const events = await this.getEventsForWeek(weekStart);
    view.setEvents(events);
  }

  // Sync calendar from Feishu (supports both CalDAV and Open API)
  async syncFeishuCalendar(): Promise<void> {
    if (!this.settings.feishu.syncEnabled) {
      new Notice('飞书同步未启用，请先在设置中启用');
      return;
    }

    // Check if using CalDAV
    const useCalDav = this.settings.feishu.useCalDav;

    if (useCalDav) {
      if (!this.settings.feishu.caldavUsername || !this.settings.feishu.caldavPassword) {
        new Notice('请先在设置中配置 CalDAV 用户名和密码');
        return;
      }
    } else {
      if (!this.settings.feishu.appId || !this.settings.feishu.appSecret) {
        new Notice('请先在设置中配置飞书 App ID 和 App Secret');
        return;
      }
      if (!this.settings.feishu.accessToken) {
        new Notice('请先登录飞书账号');
        return;
      }
    }

    try {
      new Notice(useCalDav ? '正在通过 CalDAV 同步日历...' : '正在同步飞书日历...');

      // Get the week currently displayed in the view (not necessarily "this week")
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOCUS_PLANNER);
      let weekStart: Date;

      if (leaves.length > 0) {
        const view = leaves[0].view as FocusPlannerView;
        weekStart = view.getCurrentWeekStart();
      } else {
        // Fallback to current week if view is not open
        const today = new Date();
        weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay() + 1);
        weekStart.setHours(0, 0, 0, 0);
      }

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      console.log('[Focus Planner] Syncing week:', weekStart.toISOString(), 'to', weekEnd.toISOString());
      console.log('[Focus Planner] Using CalDAV:', useCalDav);

      // Fetch events using the appropriate method
      let feishuEvents: CalendarEvent[];
      if (useCalDav) {
        feishuEvents = await this.caldavClient.getEvents(weekStart, weekEnd);
      } else {
        feishuEvents = await this.feishuApi.getEvents(weekStart, weekEnd);
      }

      // Group events by date
      const eventsByDate = new Map<string, CalendarEvent[]>();
      for (const event of feishuEvents) {
        const dateKey = event.start.toISOString().split('T')[0];
        if (!eventsByDate.has(dateKey)) {
          eventsByDate.set(dateKey, []);
        }
        eventsByDate.get(dateKey)!.push(event);
      }

      // Write events to daily notes
      for (const [dateStr, events] of eventsByDate) {
        const date = new Date(dateStr);
        await this.dailyNoteParser.writeEventsToDailyNote(date, events);
      }

      // Update last sync time
      this.settings.feishu.lastSync = Date.now();
      await this.saveSettings();

      // Refresh view
      await this.refreshView();

      new Notice(`${useCalDav ? 'CalDAV' : '飞书'}同步完成！同步了 ${feishuEvents.length} 个日程`);
    } catch (error) {
      console.error('Feishu sync error:', error);
      new Notice(`同步失败: ${error.message}`);
    }
  }

  // Login to Feishu - Step 1: Open OAuth page
  async loginFeishu(): Promise<void> {
    if (!this.settings.feishu.appId || !this.settings.feishu.appSecret) {
      new Notice('请先在设置中配置飞书 App ID 和 App Secret');
      return;
    }

    const oauthUrl = this.feishuApi.getOAuthUrl('http://localhost:3000/callback');

    new Notice(
      '浏览器将打开飞书授权页面。\n' +
      '登录后，复制 URL 中的 code 参数，\n' +
      '然后点击「输入授权码」按钮粘贴。'
    );

    // Open OAuth URL in browser
    window.open(oauthUrl);
  }

  // Login to Feishu - Step 2: Handle authorization code
  async handleAuthCode(code: string): Promise<void> {
    if (!code) {
      new Notice('授权码不能为空');
      return;
    }

    try {
      new Notice('正在验证授权码...');

      const tokens = await this.feishuApi.getUserAccessToken(code);

      this.settings.feishu.accessToken = tokens.accessToken;
      this.settings.feishu.refreshToken = tokens.refreshToken;
      this.settings.feishu.tokenExpiry = Date.now() + tokens.expiresIn * 1000;

      await this.saveSettings();

      // Start auto-sync
      this.startAutoSync();

      new Notice('飞书登录成功！');
    } catch (error) {
      console.error('Feishu auth error:', error);
      new Notice(`登录失败: ${error.message}`);
    }
  }

  // Handle event click in calendar
  private handleEventClick(event: CalendarEvent) {
    if (event.filePath) {
      // Open the source file
      const file = this.app.vault.getAbstractFileByPath(event.filePath);
      if (file) {
        this.app.workspace.openLinkText('', event.filePath);
      }
    }
  }

  // Start pomodoro timer for an event
  private async startPomodoroForEvent(event: CalendarEvent) {
    // Try to execute the pomodoro-timer plugin's toggle command
    // @ts-ignore - accessing internal API
    const pomodoroPlugin = this.app.plugins?.plugins?.['pomodoro-timer'];

    if (pomodoroPlugin) {
      // Execute the toggle-timer command
      // @ts-ignore
      this.app.commands.executeCommandById('pomodoro-timer:toggle-timer');

      // Show floating timer window
      this.floatingTimer.show(event.title, () => {
        // Called when timer completes (optional callback)
        new Notice(`🍅 番茄钟完成: ${event.title}`);
      });

      // Start updating the floating timer display
      this.startTimerUpdate();

      // Try to update the linked task
      let taskUpdated = false;
      let newDone = 0;
      let totalPomos = 0;

      // First, try using the saved task link (from drag-and-drop)
      if (event.taskSourcePath && event.taskLineNumber) {
        const task = await this.taskParser.findTaskByLocation(event.taskSourcePath, event.taskLineNumber);
        if (task) {
          taskUpdated = await this.taskParser.incrementTaskDone(task);
          newDone = task.pomodorosDone + 1;
          totalPomos = task.pomodoros;
        }
      }

      // Fallback: try to find by title match
      if (!taskUpdated) {
        const task = await this.taskParser.findTaskByTitle(event.title);
        if (task) {
          taskUpdated = await this.taskParser.incrementTaskDone(task);
          newDone = task.pomodorosDone + 1;
          totalPomos = task.pomodoros;
        }
      }

      if (taskUpdated) {
        const total = totalPomos > 0 ? `/${totalPomos}` : '';
        new Notice(`🍅 开始番茄钟: ${event.title}\n📝 已完成: ${newDone}${total}🍅`);
      } else {
        new Notice(`🍅 开始番茄钟: ${event.title}`);
      }
    } else {
      new Notice('请先安装并启用 Pomodoro Timer 插件');
    }
  }

  // Handle event deletion (context menu)
  private async handleEventDelete(event: CalendarEvent): Promise<void> {
    if (event.source !== 'local') {
      throw new Error('只能删除本地日报中的事件');
    }

    const date = new Date(event.start);
    date.setHours(0, 0, 0, 0);

    // Remove from daily note
    await this.dailyNoteParser.removeEventFromDailyNote(date, event);

    // Refresh view
    await this.refreshView();
  }

  // Handle event creation (double-click on calendar or drag from task panel)
  private async handleEventCreate(data: NewEventData): Promise<void> {
    const date = new Date(data.start);
    date.setHours(0, 0, 0, 0);

    // Create a new CalendarEvent object
    const newEvent: CalendarEvent = {
      id: `local-new-${Date.now()}`,
      title: data.title,
      start: data.start,
      end: data.end,
      category: data.category,
      source: 'local',
      // Save task link for pomodoro tracking
      taskSourcePath: data.taskSourcePath,
      taskLineNumber: data.taskLineNumber,
    };

    // Add to daily note
    await this.dailyNoteParser.addEventToDailyNote(date, newEvent);

    // Refresh view
    await this.refreshView();
  }

  // Handle event update (drag and drop)
  private async handleEventUpdate(event: CalendarEvent, newStart: Date, newEnd: Date): Promise<void> {
    // Check if it's a local event (from daily note)
    if (event.source !== 'local' || !event.filePath) {
      throw new Error('只能移动本地日报中的事件');
    }

    const oldDate = new Date(event.start);
    oldDate.setHours(0, 0, 0, 0);
    const newDate = new Date(newStart);
    newDate.setHours(0, 0, 0, 0);

    const dateChanged = oldDate.getTime() !== newDate.getTime();

    if (dateChanged) {
      // Cross-day move: remove from old file, add to new file
      await this.dailyNoteParser.removeEventFromDailyNote(oldDate, event);
      await this.dailyNoteParser.addEventToDailyNote(newDate, {
        ...event,
        start: newStart,
        end: newEnd,
      });
    } else {
      // Same day: just update the time
      await this.dailyNoteParser.updateEventInDailyNote(event, newStart, newEnd);
    }

    // Refresh view
    await this.refreshView();
  }

  // Start auto-sync interval
  private startAutoSync() {
    this.stopAutoSync();

    const useCalDav = this.settings.feishu.useCalDav;
    const hasCredentials = useCalDav
      ? (this.settings.feishu.caldavUsername && this.settings.feishu.caldavPassword)
      : this.settings.feishu.accessToken;

    if (
      this.settings.feishu.syncEnabled &&
      hasCredentials &&
      this.settings.feishu.syncInterval > 0
    ) {
      const intervalMs = this.settings.feishu.syncInterval * 60 * 1000;
      this.syncIntervalId = window.setInterval(async () => {
        await this.syncFeishuCalendar();
      }, intervalMs);
    }
  }

  // Stop auto-sync interval
  private stopAutoSync() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  // Start polling pomodoro timer state and updating floating window
  private startTimerUpdate() {
    this.stopTimerUpdate();

    // Poll every 500ms to update the floating timer display
    this.timerUpdateIntervalId = window.setInterval(() => {
      this.updateFloatingTimer();
    }, 500);
  }

  // Stop timer update interval
  private stopTimerUpdate() {
    if (this.timerUpdateIntervalId !== null) {
      window.clearInterval(this.timerUpdateIntervalId);
      this.timerUpdateIntervalId = null;
    }
  }

  // Update the floating timer display with current pomodoro state
  private updateFloatingTimer() {
    // @ts-ignore - accessing internal API
    const pomodoroPlugin = this.app.plugins?.plugins?.['pomodoro-timer'];

    if (!pomodoroPlugin) {
      this.stopTimerUpdate();
      this.floatingTimer.hide();
      return;
    }

    // Try to get timer state from the pomodoro plugin
    // The pomodoro-timer plugin exposes its state via different properties
    // @ts-ignore
    const timerState = pomodoroPlugin.timer || pomodoroPlugin.state;

    if (timerState) {
      const running = timerState.running || false;
      const remained = timerState.remained || { minutes: 0, seconds: 0 };
      const mode = timerState.mode || 'work';

      // Update the floating timer display
      this.floatingTimer.updateDisplay(
        remained.minutes || 0,
        remained.seconds || 0,
        running,
        mode
      );

      // If timer is not running and not paused (i.e., completed or stopped), hide the window
      if (!running && remained.minutes === 0 && remained.seconds === 0) {
        this.stopTimerUpdate();
        // Keep window visible for a moment to show completion
        setTimeout(() => {
          if (!this.timerUpdateIntervalId) {
            this.floatingTimer.hide();
          }
        }, 3000);
      }
    } else {
      // Try alternative property names used by different versions
      // @ts-ignore
      const time = pomodoroPlugin.timeRemaining || pomodoroPlugin.remainingTime;
      // @ts-ignore
      const isRunning = pomodoroPlugin.isRunning || pomodoroPlugin.running;
      // @ts-ignore
      const currentMode = pomodoroPlugin.currentMode || pomodoroPlugin.mode || 'work';

      if (typeof time === 'number') {
        const minutes = Math.floor(time / 60);
        const seconds = time % 60;
        this.floatingTimer.updateDisplay(minutes, seconds, isRunning, currentMode);
      }
    }
  }
}
