import { App, TFile, TFolder } from 'obsidian';
import { EventCategory } from './types';

// Task status from checkbox
export type TaskStatus = 'todo' | 'done' | 'in_progress' | 'cancelled' | 'deferred';

// Task priority
export type TaskPriority = 'highest' | 'high' | 'normal' | 'low';

// Parsed task interface
export interface ParsedTask {
  raw: string;              // Original text
  title: string;            // Task title (cleaned)
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;     // 📅 date
  scheduledDate: Date | null; // ⏳ date
  pomodoros: number;        // [pomo:: N] estimate
  tags: string[];           // #tag1 #tag2
  sourcePath: string;       // Source file path
  lineNumber: number;       // Line number in file
}

// Task panel data
export interface TaskPanelData {
  today: ParsedTask[];
  thisWeek: ParsedTask[];
  overdue: ParsedTask[];
}

// Status character mapping
const STATUS_MAP: Record<string, TaskStatus> = {
  ' ': 'todo',
  'x': 'done',
  'X': 'done',
  '/': 'in_progress',
  '-': 'cancelled',
  '>': 'deferred',
};

export class TaskParser {
  private app: App;
  private taskSources: string[];

  constructor(app: App, taskSources?: string[]) {
    this.app = app;
    this.taskSources = taskSources || [
      'Inbox.md',
      '1. Projects/',
      '2. Areas/',
      '3. Resources/',
    ];
  }

  /**
   * Parse a single task line
   */
  parseTaskLine(line: string, sourcePath: string, lineNumber: number): ParsedTask | null {
    // Match task pattern: - [x] or - [ ]
    const taskMatch = line.match(/^[\s]*[-*]\s*\[(.)\]\s*(.+)$/);
    if (!taskMatch) return null;

    const statusChar = taskMatch[1];
    const content = taskMatch[2];

    // Get status
    const status = STATUS_MAP[statusChar] || 'todo';

    // Skip completed tasks
    if (status === 'done' || status === 'cancelled') return null;

    // Extract priority
    let priority: TaskPriority = 'normal';
    if (content.includes('⏫')) priority = 'highest';
    else if (content.includes('🔺')) priority = 'high';
    else if (content.includes('🔽')) priority = 'low';

    // Extract due date (📅 YYYY-MM-DD)
    let dueDate: Date | null = null;
    const dueDateMatches = content.match(/📅\s*(\d{4}-\d{2}-\d{2})/g);
    if (dueDateMatches && dueDateMatches.length > 0) {
      // Take the last date if multiple
      const lastMatch = dueDateMatches[dueDateMatches.length - 1];
      const dateStr = lastMatch.match(/📅\s*(\d{4}-\d{2}-\d{2})/)?.[1];
      if (dateStr) {
        dueDate = new Date(dateStr);
        dueDate.setHours(23, 59, 59); // End of day
      }
    }

    // Extract scheduled date (⏳ YYYY-MM-DD)
    let scheduledDate: Date | null = null;
    const scheduledMatch = content.match(/⏳\s*(\d{4}-\d{2}-\d{2})/);
    if (scheduledMatch) {
      scheduledDate = new Date(scheduledMatch[1]);
    }

    // Extract pomodoros [pomo:: N] or N🍅
    let pomodoros = 0;
    const pomoMatch = content.match(/\[pomo::\s*(\d+)\]/);
    if (pomoMatch) {
      pomodoros = parseInt(pomoMatch[1], 10);
    } else {
      // Also check for N🍅 format
      const tomatoMatch = content.match(/(\d+)🍅/);
      if (tomatoMatch) {
        pomodoros = parseInt(tomatoMatch[1], 10);
      }
    }

    // Extract tags
    const tags: string[] = [];
    const tagMatches = content.matchAll(/#([^\s#\[\]]+)/g);
    for (const match of tagMatches) {
      tags.push(match[1]);
    }

    // Clean title - remove metadata
    let title = content
      .replace(/⏫|🔺|🔽/g, '')                    // Priority
      .replace(/📅\s*\d{4}-\d{2}-\d{2}/g, '')     // Due date
      .replace(/⏳\s*\d{4}-\d{2}-\d{2}/g, '')     // Scheduled date
      .replace(/✅\s*\d{4}-\d{2}-\d{2}/g, '')     // Completion date
      .replace(/\[pomo::\s*\d+\]/g, '')           // Pomo estimate
      .replace(/\d+🍅/g, '')                      // Tomato format
      .replace(/#[^\s#\[\]]+/g, '')               // Tags
      .replace(/\[\[[^\]]+\]\]/g, (match) => {    // Keep wiki link text
        return match.slice(2, -2).split('|').pop() || '';
      })
      .trim();

    // Remove multiple spaces
    title = title.replace(/\s+/g, ' ').trim();

    if (!title) return null;

    return {
      raw: line,
      title,
      status,
      priority,
      dueDate,
      scheduledDate,
      pomodoros,
      tags,
      sourcePath,
      lineNumber,
    };
  }

  /**
   * Parse all tasks from a file
   */
  async parseFile(file: TFile): Promise<ParsedTask[]> {
    const tasks: ParsedTask[] = [];
    const content = await this.app.vault.read(file);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const task = this.parseTaskLine(lines[i], file.path, i + 1);
      if (task) {
        tasks.push(task);
      }
    }

    return tasks;
  }

  /**
   * Get all files from task sources
   */
  private getSourceFiles(): TFile[] {
    const files: TFile[] = [];

    for (const source of this.taskSources) {
      if (source.endsWith('/')) {
        // It's a folder
        const folder = this.app.vault.getAbstractFileByPath(source.slice(0, -1));
        if (folder instanceof TFolder) {
          this.collectFilesFromFolder(folder, files);
        }
      } else {
        // It's a file
        const file = this.app.vault.getAbstractFileByPath(source);
        if (file instanceof TFile && file.extension === 'md') {
          files.push(file);
        }
      }
    }

    return files;
  }

  /**
   * Recursively collect markdown files from a folder
   */
  private collectFilesFromFolder(folder: TFolder, files: TFile[]): void {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        // Skip template files
        if (!child.path.toLowerCase().includes('template')) {
          files.push(child);
        }
      } else if (child instanceof TFolder) {
        this.collectFilesFromFolder(child, files);
      }
    }
  }

  /**
   * Parse all tasks from configured sources
   */
  async parseAllTasks(): Promise<ParsedTask[]> {
    const allTasks: ParsedTask[] = [];
    const files = this.getSourceFiles();

    for (const file of files) {
      const tasks = await this.parseFile(file);
      allTasks.push(...tasks);
    }

    // Sort by priority then by due date
    return allTasks.sort((a, b) => {
      // Priority first
      const priorityOrder = { highest: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Then by due date
      if (a.dueDate && b.dueDate) {
        return a.dueDate.getTime() - b.dueDate.getTime();
      }
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });
  }

  /**
   * Get tasks for the panel display
   */
  async getTasksForPanel(weekStart: Date): Promise<TaskPanelData> {
    const allTasks = await this.parseAllTasks();

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const todayTasks: ParsedTask[] = [];
    const thisWeekTasks: ParsedTask[] = [];
    const overdueTasks: ParsedTask[] = [];

    for (const task of allTasks) {
      if (task.status !== 'todo' && task.status !== 'in_progress') continue;

      if (task.dueDate) {
        const dueDay = new Date(task.dueDate.getFullYear(), task.dueDate.getMonth(), task.dueDate.getDate());

        if (dueDay < today) {
          // Overdue
          overdueTasks.push(task);
        } else if (dueDay.getTime() === today.getTime()) {
          // Due today
          todayTasks.push(task);
        } else if (dueDay >= tomorrow && dueDay < weekEnd) {
          // Due this week (but not today)
          thisWeekTasks.push(task);
        }
      }
    }

    return {
      today: todayTasks,
      thisWeek: thisWeekTasks,
      overdue: overdueTasks,
    };
  }

  /**
   * Infer category from task content
   */
  inferCategory(task: ParsedTask): EventCategory {
    const text = (task.title + ' ' + task.tags.join(' ')).toLowerCase();

    // Check for meeting keywords
    if (/会议|讨论|sync|meeting|周会|seminar|oneone/i.test(text)) {
      return EventCategory.MEETING;
    }

    // Check for personal/family keywords
    if (/家|爸|妈|gym|个人|生活|湿疹|挂号/i.test(text)) {
      return EventCategory.PERSONAL;
    }

    // Check for admin keywords
    if (/报销|行政|申请|oa/i.test(text)) {
      return EventCategory.ADMIN;
    }

    // Check for rest keywords
    if (/休息|午休|break/i.test(text)) {
      return EventCategory.REST;
    }

    // Default to focus for learning/work tasks
    return EventCategory.FOCUS;
  }

  /**
   * Check if a file path is a task source
   */
  isTaskSource(filePath: string): boolean {
    for (const source of this.taskSources) {
      if (source.endsWith('/')) {
        if (filePath.startsWith(source.slice(0, -1))) {
          return true;
        }
      } else {
        if (filePath === source) {
          return true;
        }
      }
    }
    return false;
  }
}
