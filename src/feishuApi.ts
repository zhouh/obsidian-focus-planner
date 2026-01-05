import { requestUrl, RequestUrlParam } from 'obsidian';
import { CalendarEvent, EventCategory, FeishuSettings } from './types';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

export class FeishuApi {
  private settings: FeishuSettings;
  private onSettingsChange: (settings: FeishuSettings) => void;

  constructor(
    settings: FeishuSettings,
    onSettingsChange: (settings: FeishuSettings) => void
  ) {
    this.settings = settings;
    this.onSettingsChange = onSettingsChange;
  }

  updateSettings(settings: FeishuSettings) {
    this.settings = settings;
  }

  // Get tenant access token (app-level token)
  async getTenantAccessToken(): Promise<string> {
    const response = await requestUrl({
      url: `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: this.settings.appId,
        app_secret: this.settings.appSecret,
      }),
    });

    if (response.json.code !== 0) {
      throw new Error(`Failed to get tenant access token: ${response.json.msg}`);
    }

    return response.json.tenant_access_token;
  }

  // Get user access token via OAuth
  async getUserAccessToken(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const tenantToken = await this.getTenantAccessToken();

    const response = await requestUrl({
      url: `${FEISHU_API_BASE}/authen/v1/oidc/access_token`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tenantToken}`,
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code,
      }),
    });

    if (response.json.code !== 0) {
      throw new Error(`Failed to get user access token: ${response.json.msg}`);
    }

    const data = response.json.data;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  // Refresh access token
  async refreshAccessToken(): Promise<void> {
    if (!this.settings.refreshToken) {
      throw new Error('No refresh token available');
    }

    const tenantToken = await this.getTenantAccessToken();

    const response = await requestUrl({
      url: `${FEISHU_API_BASE}/authen/v1/oidc/refresh_access_token`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tenantToken}`,
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.settings.refreshToken,
      }),
    });

    if (response.json.code !== 0) {
      throw new Error(`Failed to refresh token: ${response.json.msg}`);
    }

    const data = response.json.data;
    this.settings.accessToken = data.access_token;
    this.settings.refreshToken = data.refresh_token;
    this.settings.tokenExpiry = Date.now() + data.expires_in * 1000;
    this.onSettingsChange(this.settings);
  }

  // Ensure we have a valid access token
  private async ensureValidToken(): Promise<string> {
    if (!this.settings.accessToken) {
      throw new Error('Not authenticated. Please login first.');
    }

    // Check if token is expired (with 5 min buffer)
    if (this.settings.tokenExpiry && Date.now() > this.settings.tokenExpiry - 300000) {
      await this.refreshAccessToken();
    }

    return this.settings.accessToken;
  }

  // Get all readable calendar IDs (all primary calendars named "周浩")
  async getAllCalendarIds(): Promise<string[]> {
    const token = await this.ensureValidToken();

    console.log('[Focus Planner] Getting calendar list...');

    let response;
    try {
      // 使用 calendar list API 获取所有日历
      response = await requestUrl({
        url: `${FEISHU_API_BASE}/calendar/v4/calendars?page_size=50`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        throw: false,
      });
    } catch (e) {
      console.error('[Focus Planner] Calendar list request exception:', e);
      throw new Error(`获取日历列表失败: ${e.message}`);
    }

    console.log('[Focus Planner] Calendar list response:', response.status, response.json);

    if (response.status !== 200) {
      const errorMsg = response.json?.msg || response.json?.message || `HTTP ${response.status}`;
      throw new Error(`获取日历列表失败 (${response.status}): ${errorMsg}`);
    }

    if (response.json.code !== 0) {
      throw new Error(`Failed to get calendar list: ${response.json.msg} (code: ${response.json.code})`);
    }

    const calendars = response.json.data?.calendar_list || [];
    console.log('[Focus Planner] Found calendars:', calendars.length);

    // 打印所有日历信息用于调试
    for (const cal of calendars) {
      console.log('[Focus Planner] Calendar:', {
        id: cal.calendar_id,
        summary: cal.summary,
        type: cal.type,
        role: cal.role,
        is_primary: cal.is_primary,
      });
    }

    // 收集所有有写入权限的日历（owner 或 writer）
    // reader 权限的日历 API 调用会失败
    const calendarIds: string[] = [];

    for (const cal of calendars) {
      // 只包含有 owner 或 writer 权限的日历
      if (cal.role === 'owner' || cal.role === 'writer') {
        calendarIds.push(cal.calendar_id);
        console.log('[Focus Planner] Added calendar:', cal.calendar_id, cal.summary, 'role:', cal.role);
      } else {
        console.log('[Focus Planner] Skipping calendar (no write access):', cal.calendar_id, cal.summary, 'role:', cal.role);
      }
    }

    if (calendarIds.length === 0) {
      throw new Error('未找到可用的日历，请确保飞书账号有日历权限');
    }

    console.log('[Focus Planner] Total calendars to sync:', calendarIds.length);
    return calendarIds;
  }

  // Get calendar events (from all primary calendars)
  // 获取所有事件，然后在客户端过滤和展开重复日程
  async getEvents(startTime: Date, endTime: Date): Promise<CalendarEvent[]> {
    const token = await this.ensureValidToken();

    // 获取所有需要同步的日历
    const calendarIds = await this.getAllCalendarIds();

    console.log('[Focus Planner] Fetching events from', calendarIds.length, 'calendars for range:',
      startTime.toISOString(), 'to', endTime.toISOString());

    const allEvents: CalendarEvent[] = [];
    const seenEventIds = new Set<string>(); // 用于去重

    // 从每个日历获取事件
    for (const calendarId of calendarIds) {
      try {
        const events = await this.getEventsFromCalendar(calendarId, token, startTime, endTime);

        // 去重：同一个事件可能在多个日历中出现
        for (const event of events) {
          const eventKey = `${event.title}-${event.start.getTime()}`;
          if (!seenEventIds.has(eventKey)) {
            seenEventIds.add(eventKey);
            allEvents.push(event);
          } else {
            console.log('[Focus Planner] Skipping duplicate event:', event.title);
          }
        }
      } catch (e) {
        // 单个日历失败不影响其他日历
        console.error('[Focus Planner] Failed to fetch from calendar', calendarId, ':', e.message);
      }
    }

    console.log('[Focus Planner] Total unique events for this week:', allEvents.length);
    return allEvents;
  }

  // Get events from a single calendar
  private async getEventsFromCalendar(
    calendarId: string,
    token: string,
    queryStart: Date,
    queryEnd: Date
  ): Promise<CalendarEvent[]> {
    // Build URL - 飞书 API 获取日程列表
    // calendar_id 需要 URL 编码（包含 @ 等特殊字符）
    const encodedCalendarId = encodeURIComponent(calendarId);
    const url = `${FEISHU_API_BASE}/calendar/v4/calendars/${encodedCalendarId}/events?page_size=500`;

    console.log('[Focus Planner] Fetching from calendar:', calendarId);

    let response;
    try {
      response = await requestUrl({
        url,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        throw: false,
      });
    } catch (e) {
      console.error('[Focus Planner] Request exception:', e);
      throw new Error(`网络请求失败: ${e.message}`);
    }

    console.log('[Focus Planner] Response status:', response.status, 'from calendar:', calendarId);

    // Check HTTP status first
    if (response.status !== 200) {
      const errorMsg = response.json?.msg || response.json?.message || `HTTP ${response.status}`;
      const errorCode = response.json?.code;
      console.error('[Focus Planner] API error from calendar', calendarId, ':', errorCode, errorMsg);
      throw new Error(`API 请求失败 (${errorCode || response.status}): ${errorMsg}`);
    }

    if (response.json.code !== 0) {
      console.error('[Focus Planner] API error code from calendar', calendarId, ':', response.json.code, response.json.msg);
      throw new Error(`Failed to get events: ${response.json.msg} (code: ${response.json.code})`);
    }

    const rawItems = response.json.data?.items || [];
    console.log('[Focus Planner] Raw events from calendar', calendarId, ':', rawItems.length);

    const events: CalendarEvent[] = [];
    for (const item of rawItems) {
      // 跳过已取消的事件
      if (item.status === 'cancelled') {
        continue;
      }

      // 解析事件，可能返回多个实例（重复日程）
      const parsedEvents = this.parseFeishuEvent(item, queryStart, queryEnd);
      for (const event of parsedEvents) {
        events.push(event);
      }
    }

    console.log('[Focus Planner] Events from calendar', calendarId, ':', events.length);
    return events;
  }

  // Parse Feishu event to our CalendarEvent format
  // 处理重复日程，返回在查询范围内的所有实例
  private parseFeishuEvent(feishuEvent: any, queryStart: Date, queryEnd: Date): CalendarEvent[] {
    try {
      const startTime = feishuEvent.start_time;
      const endTime = feishuEvent.end_time;
      const recurrence = feishuEvent.recurrence; // RRULE 字符串

      let eventStart: Date;
      let eventEnd: Date;
      let isAllDay = false;

      // 处理全天事件 - 使用 date 字段
      if (startTime?.date && !startTime?.timestamp) {
        isAllDay = true;
        eventStart = new Date(startTime.date + 'T09:00:00');
        eventEnd = new Date((endTime?.date || startTime.date) + 'T18:00:00');
      } else if (startTime?.timestamp && endTime?.timestamp) {
        eventStart = new Date(parseInt(startTime.timestamp) * 1000);
        eventEnd = new Date(parseInt(endTime.timestamp) * 1000);
      } else {
        console.log('[Focus Planner] Cannot parse time for event:', feishuEvent.summary);
        return [];
      }

      const duration = eventEnd.getTime() - eventStart.getTime();
      const title = feishuEvent.summary || 'Untitled Event';
      const category = this.categorizeEvent(title);

      // 如果没有重复规则，检查是否在查询范围内
      if (!recurrence) {
        if (eventEnd >= queryStart && eventStart <= queryEnd) {
          return [{
            id: `feishu-${feishuEvent.event_id}`,
            title,
            start: eventStart,
            end: eventEnd,
            category,
            source: 'feishu',
            feishuEventId: feishuEvent.event_id,
          }];
        }
        return [];
      }

      // 有重复规则，展开在查询范围内的所有实例
      const instances = this.expandRecurrence(eventStart, duration, recurrence, queryStart, queryEnd);

      return instances.map((instanceStart, index) => ({
        id: `feishu-${feishuEvent.event_id}-${index}`,
        title,
        start: instanceStart,
        end: new Date(instanceStart.getTime() + duration),
        category,
        source: 'feishu',
        feishuEventId: feishuEvent.event_id,
      }));
    } catch (e) {
      console.error('Failed to parse Feishu event:', e, feishuEvent);
      return [];
    }
  }

  // 展开重复规则，返回在查询范围内的所有实例开始时间
  private expandRecurrence(eventStart: Date, duration: number, rrule: string, queryStart: Date, queryEnd: Date): Date[] {
    const instances: Date[] = [];

    // 解析 RRULE
    // 例如: "FREQ=DAILY;INTERVAL=1" 或 "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
    const rules: Record<string, string> = {};
    for (const part of rrule.split(';')) {
      const [key, value] = part.split('=');
      if (key && value) {
        rules[key] = value;
      }
    }

    const freq = rules['FREQ'];
    const interval = parseInt(rules['INTERVAL'] || '1');
    const until = rules['UNTIL'] ? this.parseRRuleDate(rules['UNTIL']) : null;
    const count = rules['COUNT'] ? parseInt(rules['COUNT']) : null;
    const byDay = rules['BYDAY']?.split(',') || [];

    // 确定重复结束日期
    let repeatEnd = queryEnd;
    if (until && until < repeatEnd) {
      repeatEnd = until;
    }

    // 从事件开始日期开始迭代
    let current = new Date(eventStart);
    let instanceCount = 0;
    const maxIterations = 1000; // 防止无限循环

    for (let i = 0; i < maxIterations && current <= repeatEnd; i++) {
      if (count && instanceCount >= count) break;

      // 检查当前日期是否在查询范围内
      const instanceEnd = new Date(current.getTime() + duration);
      if (instanceEnd >= queryStart && current <= queryEnd) {
        // 检查 BYDAY 规则
        if (byDay.length === 0 || this.matchesByDay(current, byDay)) {
          instances.push(new Date(current));
          instanceCount++;
        }
      }

      // 移动到下一个实例
      switch (freq) {
        case 'DAILY':
          current.setDate(current.getDate() + interval);
          break;
        case 'WEEKLY':
          if (byDay.length > 0) {
            // 如果有 BYDAY，每天检查
            current.setDate(current.getDate() + 1);
          } else {
            current.setDate(current.getDate() + 7 * interval);
          }
          break;
        case 'MONTHLY':
          current.setMonth(current.getMonth() + interval);
          break;
        case 'YEARLY':
          current.setFullYear(current.getFullYear() + interval);
          break;
        default:
          // 未知频率，返回空
          return [];
      }
    }

    return instances;
  }

  // 解析 RRULE 日期格式 (YYYYMMDD 或 YYYYMMDDTHHMMSSZ)
  private parseRRuleDate(dateStr: string): Date {
    if (dateStr.includes('T')) {
      // Format: YYYYMMDDTHHMMSSZ
      const year = parseInt(dateStr.substring(0, 4));
      const month = parseInt(dateStr.substring(4, 6)) - 1;
      const day = parseInt(dateStr.substring(6, 8));
      const hour = parseInt(dateStr.substring(9, 11));
      const minute = parseInt(dateStr.substring(11, 13));
      const second = parseInt(dateStr.substring(13, 15));
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    } else {
      // Format: YYYYMMDD
      const year = parseInt(dateStr.substring(0, 4));
      const month = parseInt(dateStr.substring(4, 6)) - 1;
      const day = parseInt(dateStr.substring(6, 8));
      return new Date(year, month, day);
    }
  }

  // 检查日期是否匹配 BYDAY 规则
  private matchesByDay(date: Date, byDay: string[]): boolean {
    const dayMap: Record<number, string> = {
      0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA'
    };
    const dayCode = dayMap[date.getDay()];
    return byDay.some(d => d.includes(dayCode));
  }

  // Categorize event based on title keywords
  private categorizeEvent(title: string): EventCategory {
    const lowerTitle = title.toLowerCase();

    // Check each category's keywords
    const categoryOrder: EventCategory[] = [
      EventCategory.REST,
      EventCategory.MEETING,
      EventCategory.PERSONAL,
      EventCategory.ADMIN,
      EventCategory.FOCUS,
    ];

    // This will be configured via settings
    // For now, use default keywords
    const keywords: Record<EventCategory, string[]> = {
      [EventCategory.FOCUS]: ['专注', '学习', '阅读', '代码', 'demo', '论文'],
      [EventCategory.MEETING]: ['会议', '讨论', '周会', 'seminar', 'oneone', 'sync', 'meeting'],
      [EventCategory.PERSONAL]: ['家庭', '个人', '晚间'],
      [EventCategory.REST]: ['午休', '休息', 'break'],
      [EventCategory.ADMIN]: ['报销', '行政', 'review'],
    };

    for (const category of categoryOrder) {
      for (const keyword of keywords[category]) {
        if (lowerTitle.includes(keyword.toLowerCase())) {
          return category;
        }
      }
    }

    // Default to meeting for calendar events
    return EventCategory.MEETING;
  }

  // Generate OAuth login URL
  getOAuthUrl(redirectUri: string): string {
    // 需要请求日历相关的权限 scope
    const params = new URLSearchParams({
      app_id: this.settings.appId,
      redirect_uri: redirectUri,
      state: 'focus-planner-auth',
      // 请求日历权限
      scope: 'calendar:calendar:readonly calendar:calendar:read',
    });

    return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params.toString()}`;
  }
}
