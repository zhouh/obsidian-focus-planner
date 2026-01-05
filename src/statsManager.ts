import { App } from 'obsidian';
import {
  CalendarEvent,
  PomodoroRecord,
  DailyStats,
  WeeklyStats,
  EventCategory,
  FocusPlannerSettings,
} from './types';
import { DailyNoteParser } from './dailyNoteParser';

export class StatsManager {
  private app: App;
  private settings: FocusPlannerSettings;
  private dailyNoteParser: DailyNoteParser;

  constructor(app: App, settings: FocusPlannerSettings, dailyNoteParser: DailyNoteParser) {
    this.app = app;
    this.settings = settings;
    this.dailyNoteParser = dailyNoteParser;
  }

  updateSettings(settings: FocusPlannerSettings) {
    this.settings = settings;
  }

  // Calculate daily stats from events and pomodoros
  async getDailyStats(date: Date): Promise<DailyStats> {
    const events = await this.dailyNoteParser.parseEventsFromDailyNote(date);
    const pomodoros = await this.dailyNoteParser.parsePomodorosFromDailyNote(date);

    const byCategory: Record<EventCategory, number> = {
      [EventCategory.FOCUS]: 0,
      [EventCategory.MEETING]: 0,
      [EventCategory.PERSONAL]: 0,
      [EventCategory.REST]: 0,
      [EventCategory.ADMIN]: 0,
    };

    let totalMinutes = 0;
    let pomodorosPlanned = 0;

    // Calculate time from events
    for (const event of events) {
      const durationMs = event.end.getTime() - event.start.getTime();
      const durationMin = Math.round(durationMs / 60000);

      byCategory[event.category] += durationMin;
      totalMinutes += durationMin;

      if (event.plannedPomodoros) {
        pomodorosPlanned += event.plannedPomodoros;
      }
    }

    return {
      date: this.formatDate(date),
      totalMinutes,
      pomodorosCompleted: pomodoros.length,
      pomodorosPlanned,
      byCategory,
    };
  }

  // Calculate weekly stats
  async getWeeklyStats(weekStart: Date): Promise<WeeklyStats> {
    const dailyStats: DailyStats[] = [];
    const byCategory: Record<EventCategory, number> = {
      [EventCategory.FOCUS]: 0,
      [EventCategory.MEETING]: 0,
      [EventCategory.PERSONAL]: 0,
      [EventCategory.REST]: 0,
      [EventCategory.ADMIN]: 0,
    };

    let totalMinutes = 0;
    let totalPomodoros = 0;

    // Get stats for each day of the week (Mon-Sun)
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);

      const dayStats = await this.getDailyStats(date);
      dailyStats.push(dayStats);

      totalMinutes += dayStats.totalMinutes;
      totalPomodoros += dayStats.pomodorosCompleted;

      for (const category of Object.values(EventCategory)) {
        byCategory[category] += dayStats.byCategory[category];
      }
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    return {
      weekNumber: this.getISOWeekNumber(weekStart),
      startDate: this.formatDate(weekStart),
      endDate: this.formatDate(weekEnd),
      dailyStats,
      totalMinutes,
      totalPomodoros,
      byCategory,
    };
  }

  // Associate pomodoros with events based on time overlap
  associatePomodorosWithEvents(
    pomodoros: PomodoroRecord[],
    events: CalendarEvent[]
  ): Map<string, PomodoroRecord[]> {
    const eventPomodoros = new Map<string, PomodoroRecord[]>();

    for (const pomo of pomodoros) {
      // Find the event that overlaps with this pomodoro
      for (const event of events) {
        if (this.timeOverlaps(pomo.startTime, pomo.endTime, event.start, event.end)) {
          if (!eventPomodoros.has(event.id)) {
            eventPomodoros.set(event.id, []);
          }
          eventPomodoros.get(event.id)!.push(pomo);
          break;
        }
      }
    }

    return eventPomodoros;
  }

  // Check if two time ranges overlap
  private timeOverlaps(
    start1: Date,
    end1: Date,
    start2: Date,
    end2: Date
  ): boolean {
    return start1 < end2 && end1 > start2;
  }

  // Update event with pomodoro counts
  updateEventPomodoroCounts(
    events: CalendarEvent[],
    pomodoros: PomodoroRecord[]
  ): CalendarEvent[] {
    const eventPomoMap = this.associatePomodorosWithEvents(pomodoros, events);

    return events.map((event) => {
      const pomoList = eventPomoMap.get(event.id) || [];
      return {
        ...event,
        completedPomodoros: pomoList.length,
      };
    });
  }

  // Get events with pomodoro progress for a date range
  async getEventsWithProgress(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = [];
    const allPomodoros: PomodoroRecord[] = [];

    // Iterate through each day
    const current = new Date(startDate);
    while (current <= endDate) {
      const events = await this.dailyNoteParser.parseEventsFromDailyNote(current);
      const pomodoros = await this.dailyNoteParser.parsePomodorosFromDailyNote(current);

      allEvents.push(...events);
      allPomodoros.push(...pomodoros);

      current.setDate(current.getDate() + 1);
    }

    return this.updateEventPomodoroCounts(allEvents, allPomodoros);
  }

  // Format date as YYYY-MM-DD
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Get ISO week number
  private getISOWeekNumber(date: Date): string {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  // Generate time distribution chart data
  generateTimeDistribution(stats: WeeklyStats): { category: string; hours: number; color: string }[] {
    const distribution: { category: string; hours: number; color: string }[] = [];

    const COLORS: Record<EventCategory, string> = {
      [EventCategory.FOCUS]: '#22c55e',
      [EventCategory.MEETING]: '#3b82f6',
      [EventCategory.PERSONAL]: '#f97316',
      [EventCategory.REST]: '#6b7280',
      [EventCategory.ADMIN]: '#eab308',
    };

    const LABELS: Record<EventCategory, string> = {
      [EventCategory.FOCUS]: '专注学习',
      [EventCategory.MEETING]: '会议',
      [EventCategory.PERSONAL]: '家庭/个人',
      [EventCategory.REST]: '休息',
      [EventCategory.ADMIN]: '事务',
    };

    for (const category of Object.values(EventCategory)) {
      const minutes = stats.byCategory[category];
      if (minutes > 0) {
        distribution.push({
          category: LABELS[category],
          hours: Math.round(minutes / 60 * 10) / 10,
          color: COLORS[category],
        });
      }
    }

    return distribution.sort((a, b) => b.hours - a.hours);
  }
}
