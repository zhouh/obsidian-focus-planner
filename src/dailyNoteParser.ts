import { App, TFile } from 'obsidian';
import { CalendarEvent, EventCategory, PomodoroRecord, FocusPlannerSettings } from './types';

export class DailyNoteParser {
  private app: App;
  private settings: FocusPlannerSettings;

  constructor(app: App, settings: FocusPlannerSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: FocusPlannerSettings) {
    this.settings = settings;
  }

  // Get daily note path for a date
  getDailyNotePath(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return this.settings.dailyNotePath
      .replace(/YYYY/g, String(year))
      .replace(/MM/g, month)
      .replace(/DD/g, day);
  }

  // Parse events from a daily note
  async parseEventsFromDailyNote(date: Date): Promise<CalendarEvent[]> {
    const path = this.getDailyNotePath(date);
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      return [];
    }

    const content = await this.app.vault.read(file);
    return this.parseEventsFromContent(content, date, path);
  }

  // Parse events from markdown content
  private parseEventsFromContent(
    content: string,
    date: Date,
    filePath: string
  ): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    const lines = content.split('\n');

    let currentCategory: EventCategory | null = null;

    // Category heading patterns
    const headingPatterns: Record<string, EventCategory> = {
      '### 🎯 专注时间': EventCategory.FOCUS,
      '### 📅 会议': EventCategory.MEETING,
      '### 🏠 家庭/个人': EventCategory.PERSONAL,
      '### 😴 休息': EventCategory.REST,
    };

    // Time pattern: [startTime:: HH:MM] [endTime:: HH:MM]
    const timePattern = /\[startTime::\s*(\d{1,2}:\d{2})\s*\]\s*\[endTime::\s*(\d{1,2}:\d{2})\s*\]/;

    // First, parse the AI planning table to get planned pomodoros
    const aiPlanningPomos = this.parseAIPlanningTable(content);

    for (const line of lines) {
      // Check for category heading
      for (const [heading, category] of Object.entries(headingPatterns)) {
        if (line.trim().startsWith(heading)) {
          currentCategory = category;
          break;
        }
      }

      // Check for event line
      if (currentCategory && line.trim().startsWith('-')) {
        const match = line.match(timePattern);
        if (match) {
          const [, startTimeStr, endTimeStr] = match;

          // Extract title (everything between - and [startTime)
          const titleMatch = line.match(/^-\s*(.+?)\s*\[startTime/);
          const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

          // Parse times
          const [startHour, startMin] = startTimeStr.split(':').map(Number);
          const [endHour, endMin] = endTimeStr.split(':').map(Number);

          const startDate = new Date(date);
          startDate.setHours(startHour, startMin, 0, 0);

          const endDate = new Date(date);
          endDate.setHours(endHour, endMin, 0, 0);

          // Extract pomodoro info - first check title, then AI planning table
          let plannedPomodoros: number | undefined;

          // 1. Check if title has 🍅
          const pomoMatch = title.match(/(\d+)🍅/);
          if (pomoMatch) {
            plannedPomodoros = parseInt(pomoMatch[1]);
          } else {
            // 2. Try to match with AI planning table by task name
            const cleanTitle = title.replace(/\d+🍅/, '').trim();
            plannedPomodoros = this.findPomoInAIPlanning(cleanTitle, aiPlanningPomos);
          }

          // Extract task link (for pomodoro tracking)
          let taskSourcePath: string | undefined;
          let taskLineNumber: number | undefined;
          const taskPathMatch = line.match(/\[taskPath::\s*([^\]]+)\s*\]/);
          const taskLineMatch = line.match(/\[taskLine::\s*(\d+)\s*\]/);
          if (taskPathMatch) {
            taskSourcePath = taskPathMatch[1].trim();
          }
          if (taskLineMatch) {
            taskLineNumber = parseInt(taskLineMatch[1]);
          }

          const cleanTitle = title.replace(/\d+🍅/, '').trim();
          events.push({
            id: `local-${filePath}-${startTimeStr}-${endTimeStr}-${cleanTitle}`,
            title: cleanTitle,
            start: startDate,
            end: endDate,
            category: currentCategory,
            source: 'local',
            filePath: filePath,
            plannedPomodoros,
            taskSourcePath,
            taskLineNumber,
          });
        }
      }
    }

    return events;
  }

  // Parse AI planning table to extract task -> pomodoro mapping
  private parseAIPlanningTable(content: string): Map<string, number> {
    const pomoMap = new Map<string, number>();

    // Look for table rows like: | 📚 nanoGPT代码阅读 | 4🍅 | 下午 15:00-18:00 |
    // or: | 任务名 | 番茄钟数🍅 | 时段 |
    const tableRowPattern = /\|\s*([^|]+)\s*\|\s*(\d+)🍅\s*\|/g;

    let match;
    while ((match = tableRowPattern.exec(content)) !== null) {
      let taskName = match[1].trim();
      const pomos = parseInt(match[2]);

      // Remove emoji prefixes like 📚, 👨‍👩‍👦, 🚀, 🧠, 📝, 🏠
      taskName = taskName.replace(/^[📚👨‍👩‍👦🚀🧠📝🏠]\s*/, '').trim();

      if (taskName && pomos > 0) {
        pomoMap.set(taskName.toLowerCase(), pomos);
      }
    }

    return pomoMap;
  }

  // Find pomodoro count for a task from AI planning
  private findPomoInAIPlanning(taskTitle: string, aiPomos: Map<string, number>): number | undefined {
    const normalizedTitle = taskTitle.toLowerCase();

    // Direct match
    if (aiPomos.has(normalizedTitle)) {
      return aiPomos.get(normalizedTitle);
    }

    // Partial match - if task title contains or is contained by a key
    for (const [key, value] of aiPomos) {
      if (normalizedTitle.includes(key) || key.includes(normalizedTitle)) {
        return value;
      }
    }

    return undefined;
  }

  // Parse pomodoro records from daily note
  async parsePomodorosFromDailyNote(date: Date): Promise<PomodoroRecord[]> {
    const path = this.getDailyNotePath(date);
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      return [];
    }

    const content = await this.app.vault.read(file);
    return this.parsePomodorosFromContent(content, date);
  }

  // Parse pomodoro records from content
  private parsePomodorosFromContent(content: string, date: Date): PomodoroRecord[] {
    const records: PomodoroRecord[] = [];

    // Pattern: 🍅 (pomodoro::WORK) (duration:: 25m) (begin:: 2025-12-30 17:29) - (end:: 2025-12-30 17:54)
    const pomoPattern = /🍅\s*\(pomodoro::\w+\)\s*\(duration::\s*(\d+)m\)\s*\(begin::\s*([\d-]+\s+[\d:]+)\)\s*-\s*\(end::\s*([\d-]+\s+[\d:]+)\)/g;

    let match;
    while ((match = pomoPattern.exec(content)) !== null) {
      const [, durationStr, beginStr, endStr] = match;

      const startTime = new Date(beginStr.replace(' ', 'T'));
      const endTime = new Date(endStr.replace(' ', 'T'));

      records.push({
        id: `pomo-${startTime.getTime()}`,
        startTime,
        endTime,
        duration: parseInt(durationStr),
        category: EventCategory.FOCUS, // Default to focus
      });
    }

    return records;
  }

  // Write events to daily note's Day Planner section
  async writeEventsToDailyNote(date: Date, events: CalendarEvent[]): Promise<void> {
    const path = this.getDailyNotePath(date);
    let file = this.app.vault.getAbstractFileByPath(path) as TFile;

    if (!file) {
      // Create the daily note if it doesn't exist
      await this.createDailyNote(date);
      file = this.app.vault.getAbstractFileByPath(path) as TFile;
    }

    if (!file) {
      throw new Error(`Failed to create daily note at ${path}`);
    }

    const content = await this.app.vault.read(file);
    const updatedContent = this.updateDayPlannerSection(content, events);
    await this.app.vault.modify(file, updatedContent);
  }

  // Create a new daily note
  private async createDailyNote(date: Date): Promise<void> {
    const path = this.getDailyNotePath(date);

    // Ensure directory exists
    const dir = path.substring(0, path.lastIndexOf('/'));
    const existingDir = this.app.vault.getAbstractFileByPath(dir);
    if (!existingDir) {
      await this.app.vault.createFolder(dir);
    }

    const template = this.getDailyNoteTemplate(date);
    await this.app.vault.create(path, template);
  }

  // Get daily note template
  private getDailyNoteTemplate(date: Date): string {
    const dateStr = date.toISOString().split('T')[0];
    return `
# **今日主题：** \`待填写\`

# 今日TODO
%%Your Record%%

\`\`\`tasks
((folder includes 1. Projects) OR (folder includes 2. Areas) OR (folder includes 3. Resources) OR (filename includes Inbox)) AND ((due on today) OR (status.type is IN_PROGRESS) OR (due before today))
not done
sort by due
\`\`\`

# Day planner
### 今天从哪开始？

待填写

### 🎯 专注时间

### 📅 会议

### 🏠 家庭/个人

### 😴 休息

## 💭 每日反思


---

## Completed today
%%List of tasks completed today, extracted from all notes%%
\`\`\`PeriodicPARA
TaskDoneListByTime
\`\`\`
`;
  }

  // Update Day Planner section with events
  // IMPORTANT: Only update sections that have events from sync, preserve local focus time
  private updateDayPlannerSection(content: string, events: CalendarEvent[]): string {
    // Group events by category
    const byCategory: Record<EventCategory, CalendarEvent[]> = {
      [EventCategory.FOCUS]: [],
      [EventCategory.MEETING]: [],
      [EventCategory.PERSONAL]: [],
      [EventCategory.REST]: [],
      [EventCategory.ADMIN]: [],
    };

    for (const event of events) {
      byCategory[event.category].push(event);
    }

    // Sort events by start time
    for (const category of Object.values(EventCategory)) {
      byCategory[category].sort((a, b) => a.start.getTime() - b.start.getTime());
    }

    const sectionHeadings: Record<EventCategory, string> = {
      [EventCategory.FOCUS]: '### 🎯 专注时间',
      [EventCategory.MEETING]: '### 📅 会议',
      [EventCategory.PERSONAL]: '### 🏠 家庭/个人',
      [EventCategory.REST]: '### 😴 休息',
      [EventCategory.ADMIN]: '### 📝 事务',
    };

    // Create reverse mapping: heading -> category
    const headingToCategory: Record<string, EventCategory> = {};
    for (const [cat, heading] of Object.entries(sectionHeadings)) {
      headingToCategory[heading] = cat as EventCategory;
    }

    // Process content line by line for more reliable section replacement
    const lines = content.split('\n');
    const result: string[] = [];
    let currentSyncCategory: EventCategory | null = null; // Track if we're in a section being synced

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Check if this line is a section heading we care about
      let foundCategory: EventCategory | null = null;
      for (const [heading, category] of Object.entries(headingToCategory)) {
        if (trimmedLine === heading || trimmedLine.startsWith(heading)) {
          foundCategory = category;
          break;
        }
      }

      if (foundCategory !== null) {
        // We hit a section heading we care about
        // First, add the heading
        result.push(line);

        // Check if we have sync events for this category
        if (byCategory[foundCategory].length > 0) {
          // We have events to sync - add them and mark this section for cleanup
          currentSyncCategory = foundCategory;
          for (const event of byCategory[foundCategory]) {
            const startTime = this.formatTime(event.start);
            const endTime = this.formatTime(event.end);
            let eventLine = `- ${event.title} [startTime:: ${startTime}] [endTime:: ${endTime}]`;
            if (event.taskSourcePath && event.taskLineNumber) {
              eventLine += ` [taskPath:: ${event.taskSourcePath}] [taskLine:: ${event.taskLineNumber}]`;
            }
            result.push(eventLine);
          }
        } else {
          // No sync events for this category - preserve existing content
          currentSyncCategory = null;
        }
        continue;
      }

      // Check if we hit any other heading (### or ##) that ends current section
      if (trimmedLine.startsWith('### ') || trimmedLine.startsWith('## ')) {
        currentSyncCategory = null;
        result.push(line);
        continue;
      }

      // If we're in a section that has sync events, skip old event lines
      if (currentSyncCategory !== null) {
        // Skip lines that look like events (start with - and have time fields)
        if (trimmedLine.startsWith('-') && line.includes('[startTime::')) {
          continue; // Skip this old event line - we already added the new ones
        }
      }

      result.push(line);
    }

    return result.join('\n');
  }

  // Generate section content from events
  private generateSectionContent(events: CalendarEvent[]): string {
    if (events.length === 0) {
      return '';
    }

    return events
      .map((event) => {
        const startTime = this.formatTime(event.start);
        const endTime = this.formatTime(event.end);
        let line = `- ${event.title} [startTime:: ${startTime}] [endTime:: ${endTime}]`;

        // Add task link if available (for pomodoro tracking)
        if (event.taskSourcePath && event.taskLineNumber) {
          line += ` [taskPath:: ${event.taskSourcePath}] [taskLine:: ${event.taskLineNumber}]`;
        }

        return line;
      })
      .join('\n');
  }

  // Format time as HH:MM
  private formatTime(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  // Update an event's time in the daily note
  async updateEventInDailyNote(event: CalendarEvent, newStart: Date, newEnd: Date): Promise<void> {
    if (!event.filePath) {
      throw new Error('Event has no file path');
    }

    const file = this.app.vault.getAbstractFileByPath(event.filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${event.filePath}`);
    }

    const content = await this.app.vault.read(file);
    const oldStartTime = this.formatTime(event.start);
    const oldEndTime = this.formatTime(event.end);
    const newStartTime = this.formatTime(newStart);
    const newEndTime = this.formatTime(newEnd);

    // Find the event line and update it
    // Pattern: - EventTitle [startTime:: HH:MM] [endTime:: HH:MM] (optional taskPath/taskLine)
    // We need to preserve any trailing fields like [taskPath::] [taskLine::]
    const eventLinePattern = new RegExp(
      `^(-\\s*${this.escapeRegex(event.title)}\\s*)\\[startTime::\\s*${oldStartTime}\\s*\\]\\s*\\[endTime::\\s*${oldEndTime}\\s*\\](.*)$`,
      'gm'
    );

    const updatedContent = content.replace(
      eventLinePattern,
      `$1[startTime:: ${newStartTime}] [endTime:: ${newEndTime}]$2`
    );

    if (updatedContent === content) {
      // Try a more relaxed match if exact match fails
      const relaxedPattern = new RegExp(
        `^(-\\s*.+?)\\[startTime::\\s*${oldStartTime}\\s*\\]\\s*\\[endTime::\\s*${oldEndTime}\\s*\\](.*)$`,
        'gm'
      );
      const relaxedContent = content.replace(
        relaxedPattern,
        (match, prefix, suffix) => {
          // Only replace if title matches
          if (match.includes(event.title)) {
            return `${prefix}[startTime:: ${newStartTime}] [endTime:: ${newEndTime}]${suffix}`;
          }
          return match;
        }
      );

      if (relaxedContent !== content) {
        await this.app.vault.modify(file, relaxedContent);
        return;
      }

      throw new Error(`Could not find event to update: ${event.title}`);
    }

    await this.app.vault.modify(file, updatedContent);
  }

  // Remove an event from a daily note
  async removeEventFromDailyNote(date: Date, event: CalendarEvent): Promise<void> {
    const path = this.getDailyNotePath(date);
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }

    const content = await this.app.vault.read(file);
    const startTime = this.formatTime(event.start);
    const endTime = this.formatTime(event.end);

    // Find and remove the event line
    const lines = content.split('\n');
    const filteredLines = lines.filter(line => {
      // Check if this line matches the event
      if (!line.trim().startsWith('-')) return true;
      if (!line.includes(`[startTime:: ${startTime}]`)) return true;
      if (!line.includes(`[endTime:: ${endTime}]`)) return true;
      if (!line.includes(event.title)) return true;
      return false; // Remove this line
    });

    const updatedContent = filteredLines.join('\n');
    await this.app.vault.modify(file, updatedContent);
  }

  // Add an event to a daily note
  async addEventToDailyNote(date: Date, event: CalendarEvent): Promise<void> {
    const path = this.getDailyNotePath(date);
    let file = this.app.vault.getAbstractFileByPath(path) as TFile;

    if (!file) {
      // Create the daily note if it doesn't exist
      await this.createDailyNote(date);
      file = this.app.vault.getAbstractFileByPath(path) as TFile;
    }

    if (!file) {
      throw new Error(`Failed to create daily note at ${path}`);
    }

    const content = await this.app.vault.read(file);
    const startTime = this.formatTime(event.start);
    const endTime = this.formatTime(event.end);

    // Build event line with optional task link
    let eventLine = `- ${event.title} [startTime:: ${startTime}] [endTime:: ${endTime}]`;
    if (event.taskSourcePath && event.taskLineNumber) {
      eventLine += ` [taskPath:: ${event.taskSourcePath}] [taskLine:: ${event.taskLineNumber}]`;
    }

    // Find the appropriate section heading based on category
    const sectionHeadings: Record<EventCategory, string> = {
      [EventCategory.FOCUS]: '### 🎯 专注时间',
      [EventCategory.MEETING]: '### 📅 会议',
      [EventCategory.PERSONAL]: '### 🏠 家庭/个人',
      [EventCategory.REST]: '### 😴 休息',
      [EventCategory.ADMIN]: '### 📝 事务',
    };

    const heading = sectionHeadings[event.category];
    const lines = content.split('\n');
    let insertIndex = -1;
    let inSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim().startsWith(heading)) {
        inSection = true;
        insertIndex = i + 1;
        continue;
      }

      if (inSection) {
        // Check if we hit the next section
        if (line.trim().startsWith('### ') || line.trim().startsWith('## ')) {
          break;
        }
        // Update insert index to after last event in section
        if (line.trim().startsWith('-') && line.includes('[startTime::')) {
          insertIndex = i + 1;
        }
      }
    }

    if (insertIndex === -1) {
      throw new Error(`Could not find section ${heading} in daily note`);
    }

    // Insert the new event line
    lines.splice(insertIndex, 0, eventLine);
    const updatedContent = lines.join('\n');
    await this.app.vault.modify(file, updatedContent);
  }

  // Helper to escape regex special characters
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
