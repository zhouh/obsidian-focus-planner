/**
 * Floating Timer Window
 * Uses a native macOS window via Swift/AppKit for true cross-app visibility
 * Falls back to in-app overlay when native window fails
 */

// @ts-ignore
const { exec, spawn, execSync } = require('child_process');
// @ts-ignore
const path = require('path');
// @ts-ignore
const fs = require('fs');
// @ts-ignore
const os = require('os');

export class FloatingTimerWindow {
  private currentTaskTitle: string = '';
  private onComplete: (() => void) | null = null;
  private fallbackEl: HTMLElement | null = null;
  private nativeWindowProcess: any = null;
  private pipePath: string = '';
  private isNativeWindowActive: boolean = false;

  constructor() {
    this.pipePath = path.join(os.tmpdir(), 'focus-planner-timer-pipe');
  }

  /**
   * Show the floating timer window
   */
  show(taskTitle: string, onComplete?: () => void) {
    this.currentTaskTitle = taskTitle;
    this.onComplete = onComplete || null;

    // Try to create native floating window first
    this.createNativeWindow(taskTitle);

    // Also show in-app fallback (visible when in Obsidian)
    this.showFallbackTimer(taskTitle);
  }

  /**
   * Hide the floating timer window
   */
  hide() {
    this.hideFallbackTimer();
    this.closeNativeWindow();
  }

  /**
   * Update the timer display
   */
  updateDisplay(minutes: number, seconds: number, isRunning: boolean, mode: 'work' | 'break' = 'work') {
    // Update in-app fallback timer
    this.updateFallbackTimer(minutes, seconds, isRunning, mode);

    // Update native window if active
    if (this.isNativeWindowActive) {
      this.updateNativeWindow(minutes, seconds, isRunning, mode);
    }
  }

  /**
   * Create a native macOS floating window using Swift
   */
  private createNativeWindow(taskTitle: string) {
    // Create a Swift script that creates a floating window
    const swiftCode = `
import Cocoa

class TimerWindow: NSWindow {
    var timeLabel: NSTextField!
    var modeLabel: NSTextField!

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 120, height: 50),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )

        // Window properties for floating behavior
        self.level = .floating
        self.backgroundColor = NSColor(white: 0.1, alpha: 0.85)
        self.isOpaque = false
        self.hasShadow = true
        self.isMovableByWindowBackground = true
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        // Round corners
        self.contentView?.wantsLayer = true
        self.contentView?.layer?.cornerRadius = 10
        self.contentView?.layer?.masksToBounds = true

        // Position in top-right corner
        if let screen = NSScreen.main {
            let screenFrame = screen.visibleFrame
            let x = screenFrame.maxX - 140
            let y = screenFrame.maxY - 70
            self.setFrameOrigin(NSPoint(x: x, y: y))
        }

        setupUI()
    }

    func setupUI() {
        let contentView = self.contentView!

        // Mode emoji
        modeLabel = NSTextField(labelWithString: "🍅")
        modeLabel.font = NSFont.systemFont(ofSize: 16)
        modeLabel.alignment = .center
        modeLabel.frame = NSRect(x: 8, y: 15, width: 24, height: 20)
        contentView.addSubview(modeLabel)

        // Time label
        timeLabel = NSTextField(labelWithString: "25:00")
        timeLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 24, weight: .semibold)
        timeLabel.textColor = NSColor(red: 0.3, green: 0.8, blue: 0.4, alpha: 1.0)
        timeLabel.alignment = .center
        timeLabel.frame = NSRect(x: 32, y: 12, width: 80, height: 28)
        contentView.addSubview(timeLabel)
    }

    func updateTime(_ time: String, mode: String, isPaused: Bool) {
        timeLabel.stringValue = time
        modeLabel.stringValue = mode == "work" ? "🍅" : "☕"
        timeLabel.textColor = isPaused
            ? NSColor(red: 1.0, green: 0.76, blue: 0.03, alpha: 1.0)
            : NSColor(red: 0.3, green: 0.8, blue: 0.4, alpha: 1.0)
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: TimerWindow!
    var inputThread: Thread?

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = TimerWindow()
        window.makeKeyAndOrderFront(nil)

        // Read from stdin for updates
        inputThread = Thread {
            let handle = FileHandle.standardInput
            while true {
                if let data = try? handle.availableData, !data.isEmpty {
                    if let str = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
                        if str == "QUIT" {
                            DispatchQueue.main.async {
                                NSApp.terminate(nil)
                            }
                            break
                        }
                        // Format: TIME|MODE|PAUSED (e.g., "24:30|work|false")
                        let parts = str.split(separator: "|")
                        if parts.count >= 3 {
                            let time = String(parts[0])
                            let mode = String(parts[1])
                            let isPaused = parts[2] == "true"
                            DispatchQueue.main.async {
                                self.window.updateTime(time, mode: mode, isPaused: isPaused)
                            }
                        }
                    }
                } else {
                    break
                }
            }
        }
        inputThread?.start()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
`;

    const scriptPath = path.join(os.tmpdir(), 'focus-planner-timer.swift');

    try {
      fs.writeFileSync(scriptPath, swiftCode);

      // Compile and run the Swift script
      this.nativeWindowProcess = spawn('swift', [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.nativeWindowProcess.on('error', (err: any) => {
        console.log('[Focus Planner] Native window error:', err);
        this.isNativeWindowActive = false;
      });

      this.nativeWindowProcess.on('exit', () => {
        console.log('[Focus Planner] Native window closed');
        this.isNativeWindowActive = false;
      });

      this.isNativeWindowActive = true;
      console.log('[Focus Planner] Native floating window started');

    } catch (err) {
      console.log('[Focus Planner] Failed to create native window:', err);
      this.isNativeWindowActive = false;
    }
  }

  private updateNativeWindow(minutes: number, seconds: number, isRunning: boolean, mode: 'work' | 'break') {
    if (!this.nativeWindowProcess || !this.nativeWindowProcess.stdin) return;

    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const isPaused = !isRunning;
    const message = `${timeStr}|${mode}|${isPaused}\n`;

    try {
      this.nativeWindowProcess.stdin.write(message);
    } catch (err) {
      // Process may have died
      this.isNativeWindowActive = false;
    }
  }

  private closeNativeWindow() {
    if (this.nativeWindowProcess) {
      try {
        this.nativeWindowProcess.stdin.write('QUIT\n');
        setTimeout(() => {
          if (this.nativeWindowProcess) {
            this.nativeWindowProcess.kill();
            this.nativeWindowProcess = null;
          }
        }, 500);
      } catch (err) {
        if (this.nativeWindowProcess) {
          this.nativeWindowProcess.kill();
          this.nativeWindowProcess = null;
        }
      }
    }
    this.isNativeWindowActive = false;
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

  // ========== IN-APP FALLBACK IMPLEMENTATION ==========

  private showFallbackTimer(taskTitle: string) {
    this.hideFallbackTimer();

    this.fallbackEl = document.createElement('div');
    this.fallbackEl.id = 'focus-planner-floating-timer';
    this.fallbackEl.innerHTML = `
      <span class="fp-float-mode">🍅</span>
      <span class="fp-float-time">25:00</span>
      <span class="fp-float-close">✕</span>
    `;

    const existingStyle = document.getElementById('focus-planner-floating-timer-style');
    if (existingStyle) existingStyle.remove();

    const style = document.createElement('style');
    style.id = 'focus-planner-floating-timer-style';
    style.textContent = `
      #focus-planner-floating-timer {
        position: fixed !important;
        top: 8px !important;
        right: 80px !important;
        z-index: 2147483647 !important;
        background: rgba(20, 20, 20, 0.85) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 8px !important;
        padding: 6px 10px !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
        cursor: move;
        pointer-events: auto !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        user-select: none !important;
      }
      #focus-planner-floating-timer .fp-float-mode {
        font-size: 14px !important;
      }
      #focus-planner-floating-timer .fp-float-time {
        font-size: 18px !important;
        font-weight: 600 !important;
        font-variant-numeric: tabular-nums !important;
        color: #4CAF50 !important;
        letter-spacing: 1px !important;
      }
      #focus-planner-floating-timer.paused .fp-float-time {
        color: #FFC107 !important;
      }
      #focus-planner-floating-timer .fp-float-close {
        cursor: pointer !important;
        opacity: 0.4 !important;
        font-size: 12px !important;
        padding: 2px 4px !important;
        margin-left: 2px !important;
        color: #fff !important;
      }
      #focus-planner-floating-timer .fp-float-close:hover {
        opacity: 1 !important;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(this.fallbackEl);

    console.log('[Focus Planner] In-app timer created');

    const closeBtn = this.fallbackEl.querySelector('.fp-float-close');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });

    this.makeDraggable(this.fallbackEl);
  }

  private hideFallbackTimer() {
    if (this.fallbackEl) {
      this.fallbackEl.remove();
      this.fallbackEl = null;
    }
    document.getElementById('focus-planner-floating-timer-style')?.remove();
    try {
      // @ts-ignore
      activeDocument?.getElementById('focus-planner-floating-timer-style')?.remove();
    } catch (e) {}
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

  isVisible(): boolean {
    return this.fallbackEl !== null || this.isNativeWindowActive;
  }
}
