/**
 * Floating Timer Window
 * Creates a system-level always-on-top window showing pomodoro countdown
 */

// Access Electron's remote module through Obsidian's internal API
// @ts-ignore - accessing Electron internals
const electron = require('electron');

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
  private window: any = null;
  private updateInterval: number | null = null;
  private currentTaskTitle: string = '';
  private onComplete: (() => void) | null = null;

  constructor() {}

  /**
   * Show the floating timer window
   */
  show(taskTitle: string, onComplete?: () => void) {
    this.currentTaskTitle = taskTitle;
    this.onComplete = onComplete || null;

    if (this.window) {
      this.window.focus();
      return;
    }

    try {
      // Get BrowserWindow from Electron
      const { BrowserWindow } = electron.remote || electron;

      // Create a small always-on-top window
      this.window = new BrowserWindow({
        width: 200,
        height: 80,
        x: this.getScreenWidth() - 220,
        y: 20,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        focusable: true,
        hasShadow: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      });

      // Generate HTML content
      const html = this.generateHTML();
      this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      // Handle window close
      this.window.on('closed', () => {
        this.window = null;
        this.stopUpdating();
      });

      // Start updating the timer display
      this.startUpdating();

    } catch (error) {
      console.error('[Focus Planner] Failed to create floating window:', error);
      // Fallback: use a simpler approach with CSS position fixed
      this.showFallbackTimer(taskTitle);
    }
  }

  /**
   * Hide the floating timer window
   */
  hide() {
    if (this.window) {
      this.window.close();
      this.window = null;
    }
    this.stopUpdating();
    this.hideFallbackTimer();
  }

  /**
   * Update the timer display
   */
  updateDisplay(minutes: number, seconds: number, isRunning: boolean, mode: 'work' | 'break' = 'work') {
    if (this.window && !this.window.isDestroyed()) {
      const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      const modeEmoji = mode === 'work' ? '🍅' : '☕';
      const statusClass = isRunning ? 'running' : 'paused';

      this.window.webContents.executeJavaScript(`
        document.getElementById('time').textContent = '${timeStr}';
        document.getElementById('mode').textContent = '${modeEmoji}';
        document.getElementById('container').className = '${statusClass}';
        document.getElementById('task').textContent = '${this.escapeHtml(this.currentTaskTitle.substring(0, 20))}';
      `).catch(() => {});
    }

    // Also update fallback timer if present
    this.updateFallbackTimer(minutes, seconds, isRunning, mode);
  }

  /**
   * Get screen width for positioning
   */
  private getScreenWidth(): number {
    try {
      const { screen } = electron.remote || electron;
      const primaryDisplay = screen.getPrimaryDisplay();
      return primaryDisplay.workAreaSize.width;
    } catch {
      return 1920; // Default fallback
    }
  }

  /**
   * Generate HTML for the floating window
   */
  private generateHTML(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-user-select: none;
      user-select: none;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: transparent;
      overflow: hidden;
    }
    #container {
      background: rgba(30, 30, 30, 0.95);
      border-radius: 12px;
      padding: 12px 16px;
      color: white;
      cursor: move;
      -webkit-app-region: drag;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    #container.running {
      border-color: rgba(76, 175, 80, 0.5);
    }
    #container.paused {
      border-color: rgba(255, 193, 7, 0.5);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    #mode {
      font-size: 18px;
    }
    #task {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.7);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    .close-btn {
      font-size: 14px;
      cursor: pointer;
      opacity: 0.5;
      -webkit-app-region: no-drag;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .close-btn:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.1);
    }
    #time {
      font-size: 32px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-align: center;
      letter-spacing: 2px;
    }
    .running #time {
      color: #4CAF50;
    }
    .paused #time {
      color: #FFC107;
    }
  </style>
</head>
<body>
  <div id="container" class="running">
    <div class="header">
      <span id="mode">🍅</span>
      <span id="task">${this.escapeHtml(this.currentTaskTitle.substring(0, 20))}</span>
      <span class="close-btn" onclick="window.close()">✕</span>
    </div>
    <div id="time">25:00</div>
  </div>
  <script>
    // Allow dragging
    document.getElementById('container').addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('close-btn')) return;
    });
  </script>
</body>
</html>
    `;
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
   * Start the update interval
   */
  private startUpdating() {
    // We don't manage our own timer - the pomodoro plugin does
    // Just ensure we're ready to receive updates
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
    return this.window !== null || this.fallbackEl !== null;
  }
}
