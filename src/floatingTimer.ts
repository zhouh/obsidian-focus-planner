/**
 * Floating Timer Window
 * Uses a native macOS window via Swift/AppKit for cross-app visibility
 */

// @ts-ignore
const { spawn } = require('child_process');
// @ts-ignore
const path = require('path');
// @ts-ignore
const fs = require('fs');
// @ts-ignore
const os = require('os');

export class FloatingTimerWindow {
  private currentTaskTitle: string = '';
  private onComplete: (() => void) | null = null;
  private nativeWindowProcess: any = null;
  private isNativeWindowActive: boolean = false;

  constructor() {}

  /**
   * Show the floating timer window
   */
  show(taskTitle: string, onComplete?: () => void) {
    // Close existing window first to prevent duplicates
    this.closeNativeWindow();

    this.currentTaskTitle = taskTitle;
    this.onComplete = onComplete || null;
    this.createNativeWindow(taskTitle);
  }

  /**
   * Hide the floating timer window
   */
  hide() {
    this.closeNativeWindow();
  }

  /**
   * Update the timer display
   */
  updateDisplay(minutes: number, seconds: number, isRunning: boolean, mode: 'work' | 'break' = 'work') {
    if (this.isNativeWindowActive) {
      this.updateNativeWindow(minutes, seconds, isRunning, mode);
    }
  }

  /**
   * Create a native macOS floating window using Swift
   */
  private createNativeWindow(taskTitle: string) {
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

  isVisible(): boolean {
    return this.isNativeWindowActive;
  }
}
