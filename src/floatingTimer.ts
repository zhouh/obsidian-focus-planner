/**
 * Floating Timer Window
 * Creates a system-level always-on-top window showing pomodoro countdown
 * Supports macOS multi-desktop (Spaces) via native notification or fallback
 */

// Node.js child_process for running shell commands
// @ts-ignore
const { exec } = require('child_process');

interface TimerState {
  running: boolean;
  remained: {
    millis: number;
    minutes: number;
    seconds: number;
  };
  mode: 'work' | 'break';
  count: number; // total duration in millis
}

export class FloatingTimerWindow {
  private updateInterval: number | null = null;
  private currentTaskTitle: string = '';
  private onComplete: (() => void) | null = null;
  private lastNotificationTime: number = 0;

  constructor() {}

  /**
   * Show the floating timer window
   */
  show(taskTitle: string, onComplete?: () => void) {
    this.currentTaskTitle = taskTitle;
    this.onComplete = onComplete || null;

    // Always use the in-app fallback timer (works across app switches)
    // For cross-desktop visibility, we'll also show macOS notifications periodically
    this.showFallbackTimer(taskTitle);
  }

  /**
   * Hide the floating timer window
   */
  hide() {
    this.stopUpdating();
    this.hideFallbackTimer();
  }

  /**
   * Update the timer display
   */
  updateDisplay(minutes: number, seconds: number, isRunning: boolean, mode: 'work' | 'break' = 'work') {
    // Update fallback timer
    this.updateFallbackTimer(minutes, seconds, isRunning, mode);

    // Show macOS notification at key moments (every 5 minutes, or at 1 minute remaining)
    // This helps when user is on a different desktop
    const totalSeconds = minutes * 60 + seconds;
    const now = Date.now();

    // Notify at 5-minute intervals, 1 minute remaining, and when complete
    const shouldNotify =
      (totalSeconds > 0 && totalSeconds % 300 === 0) || // Every 5 minutes
      (totalSeconds === 60) || // 1 minute remaining
      (totalSeconds === 0 && isRunning); // Just completed

    // Rate limit notifications (at least 30 seconds apart)
    if (shouldNotify && now - this.lastNotificationTime > 30000) {
      this.lastNotificationTime = now;
      this.showMacNotification(minutes, seconds, mode);
    }
  }

  /**
   * Show macOS native notification (visible on all desktops)
   */
  private showMacNotification(minutes: number, seconds: number, mode: 'work' | 'break') {
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const modeText = mode === 'work' ? '🍅 专注中' : '☕ 休息中';
    const title = `${modeText} - ${this.currentTaskTitle.substring(0, 20)}`;
    const message = seconds === 0 && minutes === 0
      ? '番茄钟完成！'
      : `剩余时间: ${timeStr}`;

    // Use osascript to show notification (works on all macOS desktops)
    const script = `display notification "${message}" with title "${title}"`;
    exec(`osascript -e '${script}'`, (error: any) => {
      if (error) {
        console.log('[Focus Planner] Notification error:', error);
      }
    });
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Stop the update interval
   */
  private stopUpdating() {
    if (this.updateInterval !== null) {
      window.clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  // ========== FALLBACK IMPLEMENTATION ==========
  // For when Electron BrowserWindow is not available

  private fallbackEl: HTMLElement | null = null;

  private showFallbackTimer(taskTitle: string) {
    if (this.fallbackEl) return;

    this.fallbackEl = document.createElement('div');
    this.fallbackEl.id = 'focus-planner-floating-timer';
    this.fallbackEl.innerHTML = `
      <div class="fp-float-header">
        <span class="fp-float-mode">🍅</span>
        <span class="fp-float-task">${this.escapeHtml(taskTitle.substring(0, 15))}</span>
        <span class="fp-float-close">✕</span>
      </div>
      <div class="fp-float-time">25:00</div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.id = 'focus-planner-floating-timer-style';
    style.textContent = `
      #focus-planner-floating-timer {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 12px;
        padding: 12px 16px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        font-family: var(--font-interface);
        cursor: move;
      }
      .fp-float-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }
      .fp-float-mode {
        font-size: 18px;
      }
      .fp-float-task {
        font-size: 12px;
        color: var(--text-muted);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .fp-float-close {
        cursor: pointer;
        opacity: 0.5;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .fp-float-close:hover {
        opacity: 1;
        background: var(--background-modifier-hover);
      }
      .fp-float-time {
        font-size: 28px;
        font-weight: 600;
        text-align: center;
        font-variant-numeric: tabular-nums;
        color: var(--text-accent);
      }
      #focus-planner-floating-timer.paused .fp-float-time {
        color: var(--text-warning);
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(this.fallbackEl);

    // Add close handler
    const closeBtn = this.fallbackEl.querySelector('.fp-float-close');
    closeBtn?.addEventListener('click', () => this.hideFallbackTimer());

    // Make draggable
    this.makeDraggable(this.fallbackEl);
  }

  private hideFallbackTimer() {
    if (this.fallbackEl) {
      this.fallbackEl.remove();
      this.fallbackEl = null;
    }
    const style = document.getElementById('focus-planner-floating-timer-style');
    style?.remove();
  }

  private updateFallbackTimer(minutes: number, seconds: number, isRunning: boolean, mode: 'work' | 'break') {
    if (!this.fallbackEl) return;

    const timeEl = this.fallbackEl.querySelector('.fp-float-time');
    const modeEl = this.fallbackEl.querySelector('.fp-float-mode');

    if (timeEl) {
      timeEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    if (modeEl) {
      modeEl.textContent = mode === 'work' ? '🍅' : '☕';
    }

    if (isRunning) {
      this.fallbackEl.classList.remove('paused');
    } else {
      this.fallbackEl.classList.add('paused');
    }
  }

  private makeDraggable(el: HTMLElement) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    el.onmousedown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).classList.contains('fp-float-close')) return;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    };

    const elementDrag = (e: MouseEvent) => {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      el.style.top = (el.offsetTop - pos2) + "px";
      el.style.left = (el.offsetLeft - pos1) + "px";
      el.style.right = 'auto';
    };

    const closeDragElement = () => {
      document.onmouseup = null;
      document.onmousemove = null;
    };
  }

  /**
   * Check if window is currently visible
   */
  isVisible(): boolean {
    return this.fallbackEl !== null;
  }
}
