// Event categories with their colors
export enum EventCategory {
  FOCUS = 'focus',      // Green - 专注学习
  MEETING = 'meeting',  // Blue - 会议
  PERSONAL = 'personal', // Orange - 家庭/个人
  REST = 'rest',        // Gray - 休息
  ADMIN = 'admin',      // Yellow - 事务
}

export const CATEGORY_COLORS: Record<EventCategory, string> = {
  [EventCategory.FOCUS]: '#22c55e',    // Green
  [EventCategory.MEETING]: '#3b82f6',  // Blue
  [EventCategory.PERSONAL]: '#f97316', // Orange
  [EventCategory.REST]: '#6b7280',     // Gray
  [EventCategory.ADMIN]: '#eab308',    // Yellow
};

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  [EventCategory.FOCUS]: '专注学习',
  [EventCategory.MEETING]: '会议',
  [EventCategory.PERSONAL]: '家庭/个人',
  [EventCategory.REST]: '休息',
  [EventCategory.ADMIN]: '事务',
};

// Calendar event structure
export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  category: EventCategory;
  source: 'feishu' | 'local' | 'pomodoro';

  // Pomodoro tracking
  plannedPomodoros?: number;
  completedPomodoros?: number;

  // Link to source
  filePath?: string;
  feishuEventId?: string;
}

// Pomodoro record
export interface PomodoroRecord {
  id: string;
  startTime: Date;
  endTime: Date;
  duration: number; // minutes
  taskName?: string;
  eventId?: string; // linked calendar event
  category: EventCategory;
}

// Daily statistics
export interface DailyStats {
  date: string; // YYYY-MM-DD
  totalMinutes: number;
  pomodorosCompleted: number;
  pomodorosPlanned: number;
  byCategory: Record<EventCategory, number>; // minutes per category
}

// Weekly statistics
export interface WeeklyStats {
  weekNumber: string; // YYYY-WXX
  startDate: string;
  endDate: string;
  dailyStats: DailyStats[];
  totalMinutes: number;
  totalPomodoros: number;
  byCategory: Record<EventCategory, number>;
}

// Feishu calendar settings
export interface FeishuSettings {
  appId: string;
  appSecret: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  calendarId?: string;
  syncEnabled: boolean;
  syncInterval: number; // minutes
  lastSync?: number;
  // CalDAV settings (preferred method)
  useCalDav: boolean;
  caldavUsername?: string;
  caldavPassword?: string;
}

// Plugin settings
export interface FocusPlannerSettings {
  feishu: FeishuSettings;
  dailyNotePath: string;
  weeklyNotePath: string;
  pomodoroMinutes: number;
  categoryKeywords: Record<EventCategory, string[]>;
  showStatsPanel: boolean;
}

export const DEFAULT_SETTINGS: FocusPlannerSettings = {
  feishu: {
    appId: '',
    appSecret: '',
    syncEnabled: false,
    syncInterval: 15,
    useCalDav: false,
  },
  dailyNotePath: '0. PeriodicNotes/YYYY/Daily/MM/YYYY-MM-DD.md',
  weeklyNotePath: '0. PeriodicNotes/YYYY/Weekly/YYYY-WXX.md',
  pomodoroMinutes: 25,
  categoryKeywords: {
    [EventCategory.FOCUS]: ['专注', '学习', '阅读', '代码', 'demo', '论文', 'RL', 'nanoGPT'],
    [EventCategory.MEETING]: ['会议', '讨论', '周会', 'Seminar', 'oneone', 'sync', 'meeting'],
    [EventCategory.PERSONAL]: ['家庭', '个人', '湿疹', '晚间', '跨年', '退房'],
    [EventCategory.REST]: ['午休', '休息', 'break'],
    [EventCategory.ADMIN]: ['报销', '行政', 'Review', '述职'],
  },
  showStatsPanel: true,
};
