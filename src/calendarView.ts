import { ItemView, WorkspaceLeaf, Menu, Notice, Modal, App, Setting, DropdownComponent } from 'obsidian';
import {
  CalendarEvent,
  EventCategory,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  WeeklyStats,
} from './types';
import { ParsedTask, TaskPanelData } from './taskParser';

export const VIEW_TYPE_FOCUS_PLANNER = 'focus-planner-view';

// Time grid constants
const START_HOUR = 7;  // Start at 7 AM
const END_HOUR = 22;   // End at 10 PM
const HOUR_HEIGHT = 60; // 60px per hour
const TOTAL_HOURS = END_HOUR - START_HOUR;
const SNAP_MINUTES = 15; // Snap to 15-minute intervals

// Drag state interface
interface DragState {
  event: CalendarEvent;
  eventEl: HTMLElement;
  startY: number;
  startX: number;
  originalTop: number;
  originalDayIndex: number;
  currentDayIndex: number;
  isDragging: boolean;
}

// New event data for creation
export interface NewEventData {
  title: string;
  category: EventCategory;
  start: Date;
  end: Date;
  // Link to original task (for pomodoro tracking)
  taskSourcePath?: string;
  taskLineNumber?: number;
}

// Event creation modal
export class EventCreateModal extends Modal {
  private date: Date;
  private startHour: number;
  private startMinute: number;
  private onSubmit: (data: NewEventData) => void;

  private title: string = '';
  private category: EventCategory = EventCategory.FOCUS;
  private endHour: number;
  private endMinute: number;

  constructor(app: App, date: Date, startHour: number, startMinute: number, onSubmit: (data: NewEventData) => void) {
    super(app);
    this.date = date;
    this.startHour = startHour;
    this.startMinute = startMinute;
    this.endHour = startHour + 1;
    this.endMinute = startMinute;
    this.onSubmit = onSubmit;

    // Ensure end time doesn't exceed END_HOUR
    if (this.endHour >= END_HOUR) {
      this.endHour = END_HOUR;
      this.endMinute = 0;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('event-create-modal');

    contentEl.createEl('h2', { text: '创建新日程' });

    // Date display
    const dateStr = `${this.date.getMonth() + 1}/${this.date.getDate()}`;
    contentEl.createEl('p', { text: `日期: ${dateStr}`, cls: 'event-date-display' });

    // Title input
    new Setting(contentEl)
      .setName('标题')
      .addText(text => {
        text.setPlaceholder('输入日程标题')
          .onChange(value => this.title = value);
        text.inputEl.focus();
      });

    // Category dropdown
    new Setting(contentEl)
      .setName('类别')
      .addDropdown(dropdown => {
        dropdown.addOption(EventCategory.FOCUS, '🎯 专注时间');
        dropdown.addOption(EventCategory.MEETING, '📅 会议');
        dropdown.addOption(EventCategory.PERSONAL, '🏠 家庭/个人');
        dropdown.addOption(EventCategory.REST, '😴 休息');
        dropdown.addOption(EventCategory.ADMIN, '📝 事务');
        dropdown.setValue(this.category);
        dropdown.onChange(value => this.category = value as EventCategory);
      });

    // Start time
    const startTimeContainer = contentEl.createDiv({ cls: 'time-input-container' });
    startTimeContainer.createSpan({ text: '开始时间: ' });
    const startTimeSelect = this.createTimeSelect(startTimeContainer, this.startHour, this.startMinute, (h, m) => {
      this.startHour = h;
      this.startMinute = m;
    });

    // End time
    const endTimeContainer = contentEl.createDiv({ cls: 'time-input-container' });
    endTimeContainer.createSpan({ text: '结束时间: ' });
    const endTimeSelect = this.createTimeSelect(endTimeContainer, this.endHour, this.endMinute, (h, m) => {
      this.endHour = h;
      this.endMinute = m;
    });

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    const cancelBtn = buttonContainer.createEl('button', { text: '取消' });
    cancelBtn.addEventListener('click', () => this.close());

    const submitBtn = buttonContainer.createEl('button', { text: '创建', cls: 'mod-cta' });
    submitBtn.addEventListener('click', () => this.handleSubmit());

    // Handle Enter key
    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSubmit();
      }
    });
  }

  private createTimeSelect(container: HTMLElement, hour: number, minute: number, onChange: (h: number, m: number) => void): void {
    let currentHour = hour;
    let currentMinute = minute;

    // Hour select
    const hourSelect = container.createEl('select', { cls: 'time-select' });
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      const opt = hourSelect.createEl('option', { value: String(h), text: String(h).padStart(2, '0') });
      if (h === hour) opt.selected = true;
    }
    hourSelect.addEventListener('change', () => {
      currentHour = parseInt(hourSelect.value);
      onChange(currentHour, currentMinute);
    });

    container.createSpan({ text: ':' });

    // Minute select (15-minute intervals)
    const minuteSelect = container.createEl('select', { cls: 'time-select' });
    for (let m = 0; m < 60; m += SNAP_MINUTES) {
      const opt = minuteSelect.createEl('option', { value: String(m), text: String(m).padStart(2, '0') });
      if (m === minute) opt.selected = true;
    }
    minuteSelect.addEventListener('change', () => {
      currentMinute = parseInt(minuteSelect.value);
      onChange(currentHour, currentMinute);
    });
  }

  private handleSubmit() {
    if (!this.title.trim()) {
      new Notice('请输入日程标题');
      return;
    }

    // Validate time
    const startTotal = this.startHour * 60 + this.startMinute;
    const endTotal = this.endHour * 60 + this.endMinute;

    if (endTotal <= startTotal) {
      new Notice('结束时间必须晚于开始时间');
      return;
    }

    const startDate = new Date(this.date);
    startDate.setHours(this.startHour, this.startMinute, 0, 0);

    const endDate = new Date(this.date);
    endDate.setHours(this.endHour, this.endMinute, 0, 0);

    this.onSubmit({
      title: this.title.trim(),
      category: this.category,
      start: startDate,
      end: endDate,
    });

    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class FocusPlannerView extends ItemView {
  private events: CalendarEvent[] = [];
  private currentWeekStart: Date;
  private calendarContainer: HTMLElement | null = null;
  private summaryContainer: HTMLElement | null = null;
  private dragState: DragState | null = null;
  private dayColumnsContainer: HTMLElement | null = null;

  // Task panel
  private taskPanel: HTMLElement | null = null;
  private taskPanelData: TaskPanelData | null = null;

  // Callbacks
  onSyncFeishu: (() => Promise<void>) | null = null;
  onEventClick: ((event: CalendarEvent) => void) | null = null;
  onStartPomodoro: ((event: CalendarEvent) => void) | null = null;
  onEventUpdate: ((event: CalendarEvent, newStart: Date, newEnd: Date) => Promise<void>) | null = null;
  onEventCreate: ((data: NewEventData) => Promise<void>) | null = null;
  onEventDelete: ((event: CalendarEvent) => Promise<void>) | null = null;
  getWeeklyStats: ((weekStart: Date) => Promise<WeeklyStats>) | null = null;
  onWeekChange: ((weekStart: Date) => Promise<CalendarEvent[]>) | null = null;

  // Task panel callbacks
  onGetTasks: ((weekStart: Date) => Promise<TaskPanelData>) | null = null;
  onTaskInferCategory: ((task: ParsedTask) => EventCategory) | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    // Initialize to current week (Monday)
    const today = new Date();
    this.currentWeekStart = new Date(today);
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    this.currentWeekStart.setDate(diff);
    this.currentWeekStart.setHours(0, 0, 0, 0);
  }

  getViewType(): string {
    return VIEW_TYPE_FOCUS_PLANNER;
  }

  getDisplayText(): string {
    return 'Focus Planner';
  }

  getIcon(): string {
    return 'calendar-clock';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('focus-planner-container');

    // Create header
    const header = container.createDiv({ cls: 'focus-planner-header' });
    this.createHeader(header);

    // Main content area (calendar + task panel)
    const mainContent = container.createDiv({ cls: 'focus-planner-main' });

    // Calendar container
    this.calendarContainer = mainContent.createDiv({ cls: 'focus-planner-calendar' });

    // Task panel on the right
    this.taskPanel = mainContent.createDiv({ cls: 'focus-planner-task-panel' });

    // Bottom summary bar
    this.summaryContainer = container.createDiv({ cls: 'focus-planner-summary' });

    // Load events for current week and render
    await this.loadEventsForCurrentWeek();
    await this.loadTasksForPanel();
    this.renderCalendar();
    this.renderTaskPanel();
    this.updateSummaryBar();
  }

  private createHeader(container: HTMLElement) {
    const titleRow = container.createDiv({ cls: 'header-title-row' });

    // Navigation buttons
    const nav = titleRow.createDiv({ cls: 'week-nav' });

    const prevBtn = nav.createEl('button', { cls: 'nav-btn', text: '‹' });
    prevBtn.addEventListener('click', () => this.navigateWeek(-1));

    const weekTitle = nav.createEl('span', { cls: 'week-title' });
    this.updateWeekTitle(weekTitle);

    const nextBtn = nav.createEl('button', { cls: 'nav-btn', text: '›' });
    nextBtn.addEventListener('click', () => this.navigateWeek(1));

    const todayBtn = nav.createEl('button', { cls: 'today-btn', text: '今天' });
    todayBtn.addEventListener('click', () => this.goToToday());

    // Controls
    const controls = titleRow.createDiv({ cls: 'focus-planner-controls' });

    const syncBtn = controls.createEl('button', {
      cls: 'focus-planner-btn',
      text: '同步飞书',
    });
    syncBtn.addEventListener('click', async () => {
      if (this.onSyncFeishu) {
        syncBtn.textContent = '同步中...';
        syncBtn.disabled = true;
        try {
          await this.onSyncFeishu();
          syncBtn.textContent = '同步成功!';
          setTimeout(() => {
            syncBtn.textContent = '同步飞书';
            syncBtn.disabled = false;
          }, 2000);
        } catch (e) {
          syncBtn.textContent = '同步失败';
          setTimeout(() => {
            syncBtn.textContent = '同步飞书';
            syncBtn.disabled = false;
          }, 2000);
        }
      }
    });
  }

  private updateWeekTitle(element: HTMLElement) {
    const weekEnd = new Date(this.currentWeekStart);
    weekEnd.setDate(this.currentWeekStart.getDate() + 6);

    const startMonth = this.currentWeekStart.getMonth() + 1;
    const startDay = this.currentWeekStart.getDate();
    const endMonth = weekEnd.getMonth() + 1;
    const endDay = weekEnd.getDate();
    const year = this.currentWeekStart.getFullYear();

    element.textContent = `${year}年 ${startMonth}/${startDay} - ${endMonth}/${endDay}`;
  }

  private async navigateWeek(offset: number) {
    this.currentWeekStart.setDate(this.currentWeekStart.getDate() + offset * 7);

    // Fetch events for new week
    await this.loadEventsForCurrentWeek();

    this.renderCalendar();
    this.updateSummaryBar();

    const titleEl = this.containerEl.querySelector('.week-title');
    if (titleEl) {
      this.updateWeekTitle(titleEl as HTMLElement);
    }
  }

  private async goToToday() {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    this.currentWeekStart = new Date(today);
    this.currentWeekStart.setDate(diff);
    this.currentWeekStart.setHours(0, 0, 0, 0);

    // Fetch events for current week
    await this.loadEventsForCurrentWeek();

    this.renderCalendar();
    this.updateSummaryBar();

    const titleEl = this.containerEl.querySelector('.week-title');
    if (titleEl) {
      this.updateWeekTitle(titleEl as HTMLElement);
    }
  }

  // Load events for the currently displayed week
  private async loadEventsForCurrentWeek() {
    if (this.onWeekChange) {
      this.events = await this.onWeekChange(this.currentWeekStart);
    }
  }

  // Get current week start (for external access)
  getCurrentWeekStart(): Date {
    return new Date(this.currentWeekStart);
  }

  // Calculate daily pomodoro stats
  private getDailyPomoStats(date: Date): { planned: number; completed: number } {
    const dayEvents = this.events.filter((event) => {
      const eventDate = new Date(event.start);
      eventDate.setHours(0, 0, 0, 0);
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      return eventDate.getTime() === targetDate.getTime();
    });

    let planned = 0;
    let completed = 0;
    for (const event of dayEvents) {
      planned += event.plannedPomodoros || 0;
      completed += event.completedPomodoros || 0;
    }
    return { planned, completed };
  }

  private renderCalendar() {
    if (!this.calendarContainer) return;
    this.calendarContainer.empty();

    const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Create time grid container
    const grid = this.calendarContainer.createDiv({ cls: 'time-grid' });

    // Header row with day names and pomodoro pie charts
    const headerRow = grid.createDiv({ cls: 'time-grid-header' });

    // Empty cell for time column
    headerRow.createDiv({ cls: 'time-column-header' });

    // Day headers with pie charts
    for (let i = 0; i < 7; i++) {
      const date = new Date(this.currentWeekStart);
      date.setDate(this.currentWeekStart.getDate() + i);

      const dayHeader = headerRow.createDiv({ cls: 'day-header' });
      const isToday = date.getTime() === today.getTime();
      if (isToday) {
        dayHeader.addClass('today');
      }

      // Day name and date
      const dayInfo = dayHeader.createDiv({ cls: 'day-info' });
      dayInfo.createDiv({ cls: 'day-name', text: weekDays[i] });
      dayInfo.createDiv({
        cls: 'day-date',
        text: `${date.getMonth() + 1}/${date.getDate()}`,
      });

      // Pomodoro pie chart
      const pomoStats = this.getDailyPomoStats(date);
      if (pomoStats.planned > 0 || pomoStats.completed > 0) {
        const pieContainer = dayHeader.createDiv({ cls: 'pomo-pie-container' });
        this.renderPomoPieChart(pieContainer, pomoStats.completed, pomoStats.planned, isToday);
      }
    }

    // Scrollable body
    const body = grid.createDiv({ cls: 'time-grid-body' });

    // Time slots column
    const timeColumn = body.createDiv({ cls: 'time-column' });
    for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
      const slot = timeColumn.createDiv({ cls: 'time-slot' });
      slot.style.height = `${HOUR_HEIGHT}px`;
      slot.createSpan({ text: `${String(hour).padStart(2, '0')}:00` });
    }

    // Day columns with events
    const columnsContainer = body.createDiv({ cls: 'day-columns-container' });
    this.dayColumnsContainer = columnsContainer;

    for (let i = 0; i < 7; i++) {
      const date = new Date(this.currentWeekStart);
      date.setDate(this.currentWeekStart.getDate() + i);

      const dayColumn = columnsContainer.createDiv({ cls: 'day-column' });
      dayColumn.style.height = `${TOTAL_HOURS * HOUR_HEIGHT}px`;

      const isToday = date.getTime() === today.getTime();
      if (isToday) {
        dayColumn.addClass('today');
      }

      // Add hour grid lines
      for (let hour = START_HOUR; hour < END_HOUR; hour++) {
        const gridLine = dayColumn.createDiv({ cls: 'hour-line' });
        gridLine.style.top = `${(hour - START_HOUR) * HOUR_HEIGHT}px`;
      }

      // Filter events for this day
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      const dayEvents = this.events.filter((event) => {
        const eventDate = new Date(event.start);
        eventDate.setHours(0, 0, 0, 0);
        return eventDate.getTime() === targetDate.getTime();
      });

      // Sort by start time
      dayEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

      // Render events at their time positions
      for (const event of dayEvents) {
        const eventEl = this.createEventElement(event, i);
        dayColumn.appendChild(eventEl);
      }

      // Show "无日程" if no events
      if (dayEvents.length === 0) {
        const noEvents = dayColumn.createDiv({ cls: 'no-events' });
        noEvents.textContent = '点击创建日程';
      }

      // Add double-click handler for creating new events
      dayColumn.addEventListener('dblclick', (e: MouseEvent) => {
        this.handleDayColumnDoubleClick(e, date, dayColumn);
      });
    }

    // Add current time indicator if viewing current week
    this.addCurrentTimeIndicator(columnsContainer);

    // Set up drop zones for task dragging
    this.setupDropZones();
  }

  // Handle double-click on day column to create new event
  private handleDayColumnDoubleClick(e: MouseEvent, date: Date, dayColumn: HTMLElement) {
    // Don't create if clicked on an event
    const target = e.target as HTMLElement;
    if (target.closest('.calendar-event')) {
      return;
    }

    // Calculate the time from click position
    const rect = dayColumn.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;

    // Calculate hour and minute from position
    const totalMinutes = (relativeY / HOUR_HEIGHT) * 60 + START_HOUR * 60;
    const snappedMinutes = Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;

    const hour = Math.floor(snappedMinutes / 60);
    const minute = snappedMinutes % 60;

    // Clamp to valid range
    const clampedHour = Math.max(START_HOUR, Math.min(END_HOUR - 1, hour));
    const clampedMinute = minute >= 60 ? 0 : minute;

    // Open the event creation modal
    const modal = new EventCreateModal(
      this.app,
      date,
      clampedHour,
      clampedMinute,
      async (data) => {
        if (this.onEventCreate) {
          try {
            await this.onEventCreate(data);
            new Notice(`✅ 已创建: ${data.title}`);
          } catch (error) {
            new Notice(`创建失败: ${error.message}`);
          }
        }
      }
    );
    modal.open();
  }

  // Render a small pie chart for pomodoro progress
  private renderPomoPieChart(container: HTMLElement, completed: number, planned: number, isToday: boolean) {
    const size = 28;
    const strokeWidth = 4;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const percentage = planned > 0 ? (completed / planned) * 100 : 0;
    const dashOffset = circumference - (percentage / 100) * circumference;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('class', 'pomo-pie');

    // Background circle
    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', String(size / 2));
    bgCircle.setAttribute('cy', String(size / 2));
    bgCircle.setAttribute('r', String(radius));
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', isToday ? 'rgba(255,255,255,0.3)' : 'var(--background-modifier-border)');
    bgCircle.setAttribute('stroke-width', String(strokeWidth));
    svg.appendChild(bgCircle);

    // Progress circle
    if (percentage > 0) {
      const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      progressCircle.setAttribute('cx', String(size / 2));
      progressCircle.setAttribute('cy', String(size / 2));
      progressCircle.setAttribute('r', String(radius));
      progressCircle.setAttribute('fill', 'none');
      progressCircle.setAttribute('stroke', '#22c55e');
      progressCircle.setAttribute('stroke-width', String(strokeWidth));
      progressCircle.setAttribute('stroke-dasharray', String(circumference));
      progressCircle.setAttribute('stroke-dashoffset', String(dashOffset));
      progressCircle.setAttribute('stroke-linecap', 'round');
      progressCircle.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
      svg.appendChild(progressCircle);
    }

    container.appendChild(svg);

    // Text below pie
    const label = container.createDiv({ cls: 'pomo-pie-label' });
    label.textContent = `${completed}/${planned}`;
  }

  private createEventElement(event: CalendarEvent, dayIndex: number): HTMLElement {
    const eventEl = document.createElement('div');
    eventEl.className = 'calendar-event';
    eventEl.setAttribute('data-event-id', event.id);
    eventEl.setAttribute('data-day-index', String(dayIndex));

    // Calculate position based on time
    const startHour = event.start.getHours();
    const startMinute = event.start.getMinutes();
    const endHour = event.end.getHours();
    const endMinute = event.end.getMinutes();

    // Calculate top position (distance from START_HOUR)
    const startOffset = (startHour - START_HOUR) + (startMinute / 60);
    const endOffset = (endHour - START_HOUR) + (endMinute / 60);
    const duration = endOffset - startOffset;

    // Position and size
    const top = Math.max(0, startOffset * HOUR_HEIGHT);
    const height = Math.max(30, duration * HOUR_HEIGHT - 2); // Min height 30px, 2px gap

    eventEl.style.top = `${top}px`;
    eventEl.style.height = `${height}px`;
    eventEl.style.backgroundColor = CATEGORY_COLORS[event.category];
    eventEl.style.borderLeftColor = this.darkenColor(CATEGORY_COLORS[event.category], 20);

    // Event content
    const titleEl = eventEl.createDiv({ cls: 'event-title' });
    titleEl.textContent = event.title;

    const timeEl = eventEl.createDiv({ cls: 'event-time' });
    timeEl.textContent = `${this.formatTime(event.start)} - ${this.formatTime(event.end)}`;

    // Pomodoro progress (only if event is tall enough)
    if ((event.plannedPomodoros || event.completedPomodoros) && height > 50) {
      const pomoEl = eventEl.createDiv({ cls: 'event-pomodoro' });

      const completed = event.completedPomodoros || 0;
      const planned = event.plannedPomodoros || 0;

      // Icons
      let pomoText = '';
      for (let p = 0; p < Math.min(planned, 5); p++) {
        pomoText += p < completed ? '🍅' : '⚪';
      }
      if (planned > 5) {
        pomoText += `+${planned - 5}`;
      }
      if (planned > 0) {
        pomoText += ` ${completed}/${planned}`;
      }
      pomoEl.createSpan({ text: pomoText });
    }

    // Drag handle indicator
    const dragHandle = eventEl.createDiv({ cls: 'event-drag-handle' });
    dragHandle.innerHTML = '⋮⋮';

    // Mouse down handler - start drag
    eventEl.addEventListener('mousedown', (e: MouseEvent) => {
      // Only start drag on left click and not on context menu
      if (e.button !== 0) return;

      // Prevent text selection during drag
      e.preventDefault();

      this.startDrag(e, event, eventEl, dayIndex);
    });

    // Right-click handler - show menu
    eventEl.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.showEventMenu(e, event);
    });

    return eventEl;
  }

  // ========== DRAG AND DROP FUNCTIONALITY ==========

  private startDrag(e: MouseEvent, event: CalendarEvent, eventEl: HTMLElement, dayIndex: number) {
    const top = parseFloat(eventEl.style.top) || 0;

    this.dragState = {
      event,
      eventEl,
      startY: e.clientY,
      startX: e.clientX,
      originalTop: top,
      originalDayIndex: dayIndex,
      currentDayIndex: dayIndex,
      isDragging: false,
    };

    // Add global mouse move and up handlers
    document.addEventListener('mousemove', this.handleDragMove);
    document.addEventListener('mouseup', this.handleDragEnd);
  }

  private handleDragMove = (e: MouseEvent) => {
    if (!this.dragState) return;

    const deltaY = e.clientY - this.dragState.startY;
    const deltaX = e.clientX - this.dragState.startX;

    // Start dragging after moving 5 pixels
    if (!this.dragState.isDragging) {
      if (Math.abs(deltaY) > 5 || Math.abs(deltaX) > 5) {
        this.dragState.isDragging = true;
        this.dragState.eventEl.addClass('dragging');
        document.body.addClass('focus-planner-dragging');
      } else {
        return;
      }
    }

    // Calculate new top position
    let newTop = this.dragState.originalTop + deltaY;

    // Snap to 15-minute intervals
    const snapPx = (SNAP_MINUTES / 60) * HOUR_HEIGHT;
    newTop = Math.round(newTop / snapPx) * snapPx;

    // Clamp to valid range
    const maxTop = TOTAL_HOURS * HOUR_HEIGHT - 30; // Leave room for at least 30px
    newTop = Math.max(0, Math.min(newTop, maxTop));

    this.dragState.eventEl.style.top = `${newTop}px`;

    // Calculate which day column we're over
    if (this.dayColumnsContainer) {
      const dayColumns = this.dayColumnsContainer.querySelectorAll('.day-column');
      let newDayIndex = this.dragState.originalDayIndex;

      for (let i = 0; i < dayColumns.length; i++) {
        const col = dayColumns[i] as HTMLElement;
        const rect = col.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          newDayIndex = i;
          break;
        }
      }

      // If day changed, move the element to the new column
      if (newDayIndex !== this.dragState.currentDayIndex) {
        const newColumn = dayColumns[newDayIndex];
        if (newColumn) {
          newColumn.appendChild(this.dragState.eventEl);
          this.dragState.currentDayIndex = newDayIndex;
        }
      }
    }

    // Update the time display while dragging
    this.updateDragTimeDisplay();
  };

  private handleDragEnd = async (e: MouseEvent) => {
    document.removeEventListener('mousemove', this.handleDragMove);
    document.removeEventListener('mouseup', this.handleDragEnd);

    if (!this.dragState) return;

    const { event, eventEl, isDragging, originalDayIndex, currentDayIndex, originalTop } = this.dragState;

    // Remove dragging styles
    eventEl.removeClass('dragging');
    document.body.removeClass('focus-planner-dragging');

    // If we didn't actually drag, show the menu
    if (!isDragging) {
      this.dragState = null;
      this.showEventMenu(e, event);
      return;
    }

    // Calculate new times
    const newTop = parseFloat(eventEl.style.top) || 0;
    const dayChanged = currentDayIndex !== originalDayIndex;
    const timeChanged = Math.abs(newTop - originalTop) > 1;

    if (!dayChanged && !timeChanged) {
      this.dragState = null;
      return;
    }

    // Calculate new start and end times
    const hoursFromTop = newTop / HOUR_HEIGHT;
    const newStartHour = Math.floor(START_HOUR + hoursFromTop);
    const newStartMinute = Math.round((hoursFromTop % 1) * 60 / SNAP_MINUTES) * SNAP_MINUTES;

    // Duration stays the same
    const durationMs = event.end.getTime() - event.start.getTime();

    // Calculate new date based on day column
    const newDate = new Date(this.currentWeekStart);
    newDate.setDate(newDate.getDate() + currentDayIndex);

    // New start time
    const newStart = new Date(newDate);
    newStart.setHours(newStartHour, newStartMinute, 0, 0);

    // New end time (same duration)
    const newEnd = new Date(newStart.getTime() + durationMs);

    // Validate end time doesn't exceed grid
    if (newEnd.getHours() > END_HOUR || (newEnd.getHours() === END_HOUR && newEnd.getMinutes() > 0)) {
      newEnd.setHours(END_HOUR, 0, 0, 0);
    }

    this.dragState = null;

    // Call the update callback
    if (this.onEventUpdate) {
      try {
        await this.onEventUpdate(event, newStart, newEnd);
        new Notice(`📅 已移动: ${event.title} → ${this.formatTime(newStart)}-${this.formatTime(newEnd)}`);
      } catch (error) {
        new Notice(`移动失败: ${error.message}`);
        // Re-render to reset position
        this.renderCalendar();
      }
    } else {
      // No callback, just re-render
      this.renderCalendar();
    }
  };

  private updateDragTimeDisplay() {
    if (!this.dragState) return;

    const newTop = parseFloat(this.dragState.eventEl.style.top) || 0;
    const hoursFromTop = newTop / HOUR_HEIGHT;
    const newStartHour = Math.floor(START_HOUR + hoursFromTop);
    const newStartMinute = Math.round((hoursFromTop % 1) * 60 / SNAP_MINUTES) * SNAP_MINUTES;

    // Duration stays the same
    const durationMs = this.dragState.event.end.getTime() - this.dragState.event.start.getTime();
    const durationMin = durationMs / 60000;

    const endTotalMin = newStartHour * 60 + newStartMinute + durationMin;
    const newEndHour = Math.floor(endTotalMin / 60);
    const newEndMinute = endTotalMin % 60;

    // Update the time display in the event element
    const timeEl = this.dragState.eventEl.querySelector('.event-time');
    if (timeEl) {
      const startStr = `${String(newStartHour).padStart(2, '0')}:${String(newStartMinute).padStart(2, '0')}`;
      const endStr = `${String(newEndHour).padStart(2, '0')}:${String(newEndMinute).padStart(2, '0')}`;
      timeEl.textContent = `${startStr} - ${endStr}`;
    }
  }

  // ========== CONTEXT MENU ==========

  // Show context menu for event
  private showEventMenu(e: MouseEvent, event: CalendarEvent) {
    const menu = new Menu();

    // Start Pomodoro option
    menu.addItem((item) => {
      item
        .setTitle('🍅 开始番茄钟')
        .setIcon('timer')
        .onClick(() => {
          if (this.onStartPomodoro) {
            this.onStartPomodoro(event);
          }
        });
    });

    // Open source file option (if has file path)
    if (event.filePath) {
      menu.addItem((item) => {
        item
          .setTitle('📝 打开日报')
          .setIcon('file-text')
          .onClick(() => {
            if (this.onEventClick) {
              this.onEventClick(event);
            }
          });
      });
    }

    menu.addSeparator();

    // Delete option (only for local events)
    if (event.source === 'local') {
      menu.addItem((item) => {
        item
          .setTitle('🗑️ 删除日程')
          .setIcon('trash')
          .onClick(async () => {
            if (this.onEventDelete) {
              try {
                await this.onEventDelete(event);
                new Notice(`🗑️ 已删除: ${event.title}`);
              } catch (error) {
                new Notice(`删除失败: ${error.message}`);
              }
            }
          });
      });

      menu.addSeparator();
    }

    // Show event info
    menu.addItem((item) => {
      item
        .setTitle(`⏱️ ${this.formatTime(event.start)} - ${this.formatTime(event.end)}`)
        .setDisabled(true);
    });

    if (event.plannedPomodoros) {
      menu.addItem((item) => {
        item
          .setTitle(`🎯 计划 ${event.plannedPomodoros} 个番茄钟`)
          .setDisabled(true);
      });
    }

    menu.showAtMouseEvent(e);
  }

  private addCurrentTimeIndicator(container: HTMLElement) {
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if current week contains today
    const weekEnd = new Date(this.currentWeekStart);
    weekEnd.setDate(this.currentWeekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    if (today < this.currentWeekStart || today > weekEnd) {
      return; // Today is not in current week
    }

    // Calculate which day column
    const dayIndex = Math.floor((today.getTime() - this.currentWeekStart.getTime()) / (24 * 60 * 60 * 1000));
    if (dayIndex < 0 || dayIndex > 6) return;

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    if (currentHour < START_HOUR || currentHour >= END_HOUR) return;

    const top = (currentHour - START_HOUR + currentMinute / 60) * HOUR_HEIGHT;

    // Create indicator
    const indicator = container.createDiv({ cls: 'current-time-indicator' });
    indicator.style.top = `${top}px`;

    // Position it to span across the correct day
    const dayColumns = container.querySelectorAll('.day-column');
    if (dayColumns[dayIndex]) {
      const dayColumn = dayColumns[dayIndex] as HTMLElement;
      const rect = dayColumn.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      indicator.style.left = `${rect.left - containerRect.left}px`;
      indicator.style.width = `${rect.width}px`;
    }
  }

  private darkenColor(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, (num >> 16) - amt);
    const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
    const B = Math.max(0, (num & 0x0000FF) - amt);
    return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
  }

  private formatTime(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  setEvents(events: CalendarEvent[]) {
    this.events = events;
    this.renderCalendar();
    this.updateSummaryBar();
  }

  // Update bottom summary bar
  private async updateSummaryBar() {
    if (!this.summaryContainer) return;
    this.summaryContainer.empty();

    // Calculate weekly totals
    let totalPlanned = 0;
    let totalCompleted = 0;
    const byCategory: Record<EventCategory, number> = {
      [EventCategory.FOCUS]: 0,
      [EventCategory.MEETING]: 0,
      [EventCategory.PERSONAL]: 0,
      [EventCategory.REST]: 0,
      [EventCategory.ADMIN]: 0,
    };

    for (const event of this.events) {
      totalPlanned += event.plannedPomodoros || 0;
      totalCompleted += event.completedPomodoros || 0;

      const durationMs = event.end.getTime() - event.start.getTime();
      const durationMin = Math.round(durationMs / 60000);
      byCategory[event.category] += durationMin;
    }

    // Pomodoro summary
    const pomoSection = this.summaryContainer.createDiv({ cls: 'summary-section pomo-section' });
    pomoSection.createSpan({ cls: 'summary-icon', text: '🍅' });
    pomoSection.createSpan({ cls: 'summary-label', text: '本周番茄' });
    pomoSection.createSpan({ cls: 'summary-value', text: `${totalCompleted}/${totalPlanned}` });

    // Progress bar
    const progressBar = pomoSection.createDiv({ cls: 'summary-progress' });
    const progressFill = progressBar.createDiv({ cls: 'summary-progress-fill' });
    const progressPercent = totalPlanned > 0 ? (totalCompleted / totalPlanned) * 100 : 0;
    progressFill.style.width = `${progressPercent}%`;

    // Divider
    this.summaryContainer.createDiv({ cls: 'summary-divider' });

    // Category breakdown (horizontal)
    const categorySection = this.summaryContainer.createDiv({ cls: 'summary-section category-section' });

    for (const category of Object.values(EventCategory)) {
      const minutes = byCategory[category];
      if (minutes > 0) {
        const item = categorySection.createDiv({ cls: 'category-item' });
        const colorDot = item.createDiv({ cls: 'category-dot' });
        colorDot.style.backgroundColor = CATEGORY_COLORS[category];
        const hours = (minutes / 60).toFixed(1);
        item.createSpan({ text: `${CATEGORY_LABELS[category]} ${hours}h` });
      }
    }

    // Legend on the right
    this.summaryContainer.createDiv({ cls: 'summary-divider' });
    const legendSection = this.summaryContainer.createDiv({ cls: 'summary-section legend-section' });
    for (const category of Object.values(EventCategory)) {
      const item = legendSection.createDiv({ cls: 'legend-item' });
      const colorDot = item.createDiv({ cls: 'legend-dot' });
      colorDot.style.backgroundColor = CATEGORY_COLORS[category];
      item.createSpan({ text: CATEGORY_LABELS[category] });
    }
  }

  async onClose() {
    // Cleanup
  }

  // ========== TASK PANEL ==========

  // Load tasks for the panel
  private async loadTasksForPanel() {
    if (this.onGetTasks) {
      this.taskPanelData = await this.onGetTasks(this.currentWeekStart);
    }
  }

  // Render the task panel
  private renderTaskPanel() {
    if (!this.taskPanel) return;
    this.taskPanel.empty();

    // Panel header
    const header = this.taskPanel.createDiv({ cls: 'task-panel-header' });
    header.createSpan({ text: '📋 待办任务' });

    // Refresh button
    const refreshBtn = header.createEl('button', { cls: 'task-panel-refresh', text: '↻' });
    refreshBtn.addEventListener('click', async () => {
      await this.loadTasksForPanel();
      this.renderTaskPanel();
    });

    if (!this.taskPanelData) {
      this.taskPanel.createDiv({ cls: 'task-panel-empty', text: '加载中...' });
      return;
    }

    const { today, thisWeek, overdue } = this.taskPanelData;

    // Overdue section
    if (overdue.length > 0) {
      this.renderTaskSection(this.taskPanel, '🔴 已过期', overdue, 'overdue');
    }

    // Today section
    if (today.length > 0) {
      this.renderTaskSection(this.taskPanel, '🟠 今日 Due', today, 'today');
    }

    // This week section
    if (thisWeek.length > 0) {
      this.renderTaskSection(this.taskPanel, '🟡 本周 Due', thisWeek, 'week');
    }

    // Empty state
    if (overdue.length === 0 && today.length === 0 && thisWeek.length === 0) {
      const emptyDiv = this.taskPanel.createDiv({ cls: 'task-panel-empty' });
      emptyDiv.createSpan({ text: '暂无待办任务' });
      emptyDiv.createEl('br');
      emptyDiv.createSpan({ cls: 'task-panel-hint', text: '任务来源: Inbox.md, Projects/, Areas/' });
    }

    // Drag hint
    const hint = this.taskPanel.createDiv({ cls: 'task-panel-hint' });
    hint.textContent = '💡 拖拽任务到日历创建日程';
  }

  // Render a section of tasks
  private renderTaskSection(container: HTMLElement, title: string, tasks: ParsedTask[], sectionType: string) {
    const section = container.createDiv({ cls: `task-panel-section ${sectionType}` });

    const header = section.createDiv({ cls: 'task-panel-section-header' });
    header.createSpan({ text: title });
    header.createSpan({ cls: 'task-count', text: `(${tasks.length})` });

    const taskList = section.createDiv({ cls: 'task-list' });

    for (const task of tasks) {
      const taskCard = this.createTaskCard(task);
      taskList.appendChild(taskCard);
    }
  }

  // Create a draggable task card
  private createTaskCard(task: ParsedTask): HTMLElement {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.setAttribute('draggable', 'true');

    // Priority class
    card.addClass(`priority-${task.priority}`);

    // Task title
    const titleEl = card.createDiv({ cls: 'task-card-title' });

    // Priority indicator
    if (task.priority === 'highest') {
      titleEl.createSpan({ cls: 'task-priority', text: '⏫ ' });
    } else if (task.priority === 'high') {
      titleEl.createSpan({ cls: 'task-priority', text: '🔺 ' });
    }

    titleEl.createSpan({ text: task.title });

    // Meta info (pomodoros, due date, tags)
    const metaEl = card.createDiv({ cls: 'task-meta' });

    if (task.pomodoros > 0) {
      metaEl.createSpan({ cls: 'task-pomo', text: `${task.pomodoros}🍅` });
    }

    if (task.dueDate) {
      const dateStr = `${task.dueDate.getMonth() + 1}/${task.dueDate.getDate()}`;
      metaEl.createSpan({ cls: 'task-due', text: `📅 ${dateStr}` });
    }

    if (task.tags.length > 0) {
      const tagsStr = task.tags.slice(0, 2).map(t => `#${t}`).join(' ');
      metaEl.createSpan({ cls: 'task-tags', text: tagsStr });
    }

    // Click to open source file at line number
    card.addEventListener('click', (e: MouseEvent) => {
      // Don't trigger if starting a drag
      if (e.detail === 1) {
        // Single click - open file at line
        this.openTaskSource(task);
      }
    });

    // Drag events
    card.addEventListener('dragstart', (e: DragEvent) => {
      card.addClass('dragging');
      e.dataTransfer?.setData('application/json', JSON.stringify(task));
      e.dataTransfer!.effectAllowed = 'copy';
    });

    card.addEventListener('dragend', () => {
      card.removeClass('dragging');
    });

    return card;
  }

  // Set up drop zones on day columns
  private setupDropZones() {
    if (!this.dayColumnsContainer) return;

    const dayColumns = this.dayColumnsContainer.querySelectorAll('.day-column');

    dayColumns.forEach((col, index) => {
      const column = col as HTMLElement;

      column.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'copy';
        column.addClass('drop-target');
      });

      column.addEventListener('dragleave', () => {
        column.removeClass('drop-target');
      });

      column.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
        column.removeClass('drop-target');

        const taskData = e.dataTransfer?.getData('application/json');
        if (taskData) {
          try {
            const task = JSON.parse(taskData) as ParsedTask;
            const date = new Date(this.currentWeekStart);
            date.setDate(date.getDate() + index);
            this.handleTaskDrop(e, task, date, column);
          } catch (err) {
            console.error('Failed to parse dropped task:', err);
          }
        }
      });
    });
  }

  // Handle dropping a task onto the calendar
  private handleTaskDrop(e: DragEvent, task: ParsedTask, date: Date, dayColumn: HTMLElement) {
    // Calculate drop position time
    const rect = dayColumn.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;

    // Calculate hour and minute
    const totalMinutes = (relativeY / HOUR_HEIGHT) * 60 + START_HOUR * 60;
    const snappedMinutes = Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;

    const hour = Math.floor(snappedMinutes / 60);
    const minute = snappedMinutes % 60;

    // Clamp to valid range
    const clampedHour = Math.max(START_HOUR, Math.min(END_HOUR - 1, hour));
    const clampedMinute = minute >= 60 ? 0 : minute;

    // Calculate duration from pomodoros (1 pomo = 25min, default = 60min)
    const durationMinutes = task.pomodoros > 0 ? task.pomodoros * 25 : 60;

    // Create start and end times
    const startDate = new Date(date);
    startDate.setHours(clampedHour, clampedMinute, 0, 0);

    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

    // Clamp end time to END_HOUR
    if (endDate.getHours() > END_HOUR || (endDate.getHours() === END_HOUR && endDate.getMinutes() > 0)) {
      endDate.setHours(END_HOUR, 0, 0, 0);
    }

    // Infer category
    let category = EventCategory.FOCUS;
    if (this.onTaskInferCategory) {
      category = this.onTaskInferCategory(task);
    }

    // Create event with task link
    const eventData: NewEventData = {
      title: task.title,
      category,
      start: startDate,
      end: endDate,
      taskSourcePath: task.sourcePath,
      taskLineNumber: task.lineNumber,
    };

    // Call event create callback
    if (this.onEventCreate) {
      this.onEventCreate(eventData).then(() => {
        new Notice(`✅ 已创建日程: ${task.title}`);
      }).catch((error) => {
        new Notice(`创建失败: ${error.message}`);
      });
    }
  }

  // Refresh task panel (can be called externally)
  async refreshTaskPanel() {
    await this.loadTasksForPanel();
    this.renderTaskPanel();
  }

  // Open task source file at specific line
  private openTaskSource(task: ParsedTask) {
    if (!task.sourcePath) return;

    // Open the file and navigate to the line
    const file = this.app.vault.getAbstractFileByPath(task.sourcePath);
    if (file) {
      // Open file in a new leaf
      this.app.workspace.openLinkText('', task.sourcePath).then(() => {
        // After opening, scroll to the line
        const activeView = this.app.workspace.getActiveViewOfType(ItemView);
        if (activeView) {
          // @ts-ignore - accessing internal editor API
          const editor = activeView.editor;
          if (editor) {
            const line = task.lineNumber - 1; // Editor uses 0-based indexing
            editor.setCursor({ line, ch: 0 });
            editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
          }
        }
      });
    }
  }
}
