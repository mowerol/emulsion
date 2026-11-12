// SPDX-License-Identifier: GPL-3.0-or-later
// The hero take's cursor: moves the real macOS cursor through the take (pick Emulsion Neg, scrub
// Exposure and Shadows, then Halation and Grain under Refine, landing on the photo's own values)
// while ffmpeg records the window's content with the cursor. Run by tools/marketing/hero-ui.mjs,
// which feeds the app's layouts (src/dev/heroui.ts) on stdin, one JSON line each time they change.
// Needs Accessibility (to post events) and Screen Recording (ffmpeg) for the terminal app.
// Usage: swift hero-cursor.swift <out folder> <app pid>  (layouts on stdin)
import AppKit
import CoreGraphics
import Foundation

let out = CommandLine.arguments[1]
let appPid = pid_t(CommandLine.arguments[2])!

// ---- Layouts from the app, newest wins.
final class Layouts: @unchecked Sendable {
  private let lock = NSLock()
  private var current: [String: Any] = [:]
  private var changed = Date()
  private var count = 0
  func set(_ l: [String: Any]) { lock.lock(); current = l; changed = Date(); count += 1; lock.unlock() }
  var latest: [String: Any] { lock.lock(); defer { lock.unlock() }; return current }
  var n: Int { lock.lock(); defer { lock.unlock() }; return count }
  var quietFor: TimeInterval { lock.lock(); defer { lock.unlock() }; return Date().timeIntervalSince(changed) }
}
let layouts = Layouts()
Thread.detachNewThread {
  while let line = readLine() {
    if let data = line.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { layouts.set(obj) }
  }
}
/** The screen recorder, stopped on any failure so it never runs on alone. */
var recorder: Process?
func fail(_ message: String) -> Never {
  if let r = recorder, r.isRunning { r.interrupt(); r.waitUntilExit() }
  FileHandle.standardError.write("hero-cursor: \(message)\n".data(using: .utf8)!)
  exit(1)
}
func sleep(_ s: Double) { Thread.sleep(forTimeInterval: s) }
/** Wait until the app has reported a layout and then nothing new for `quiet` s. */
func settle(after n: Int = 0, quiet: Double = 0.3, limit: Double = 5) {
  let start = Date()
  while (layouts.n <= n || layouts.quietFor < quiet) && Date().timeIntervalSince(start) < limit { sleep(0.02) }
}

guard AXIsProcessTrusted() else { fail("the terminal needs Accessibility permission (System Settings › Privacy & Security › Accessibility)") }
guard CGPreflightScreenCaptureAccess() else { fail("the terminal needs Screen Recording permission (System Settings › Privacy & Security › Screen & System Audio Recording)") }

// ---- The window: its content's place on screen, in points (top-left origin), from the window server.
func windowBounds() -> [String: CGFloat] {
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  guard let info = list.first(where: { ($0[kCGWindowOwnerPID as String] as? pid_t) == appPid && ($0[kCGWindowLayer as String] as? Int) == 0 }),
        let b = info[kCGWindowBounds as String] as? [String: CGFloat] else { fail("no window for pid \(appPid)") }
  return b
}
func contentFrame() -> CGRect {
  let b = windowBounds()
  let win = layouts.latest["window"] as? [String: Double] ?? [:]
  let w = CGFloat(win["w"] ?? 0), h = CGFloat(win["h"] ?? 0)
  // The content is the window's bottom part, below the title bar.
  return CGRect(x: b["X"]!, y: b["Y"]! + b["Height"]! - h, width: w, height: h)
}

var frame = CGRect.zero
func screen(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: frame.minX + x, y: frame.minY + y) }

// ---- Elements from the latest layout, in screen points.
func rect(_ group: String, _ name: String) -> [String: Double]? { (layouts.latest[group] as? [String: Any])?[name] as? [String: Double] }
func center(_ group: String, _ name: String) -> CGPoint {
  guard let r = rect(group, name) else {
    fail("\(group) \(name) not on screen; there: \(((layouts.latest[group] as? [String: Any])?.keys).map { $0.sorted().joined(separator: ", ") } ?? "nothing")")
  }
  return screen(r["x"]! + r["w"]! / 2, r["y"]! + r["h"]! / 2)
}
let thumb = 14.0 // input.range::-webkit-slider-thumb width (styles.css)
func sliderX(_ name: String, _ value: Double) -> CGPoint {
  guard let r = rect("sliders", name) else { fail("slider \(name) not on screen") }
  let f = (value - r["min"]!) / (r["max"]! - r["min"]!)
  return screen(r["x"]! + thumb / 2 + f * (r["w"]! - thumb), r["y"]! + r["h"]! / 2)
}

// ---- Input.
var at = CGEvent(source: nil)!.location
func post(_ type: CGEventType, _ p: CGPoint) {
  let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)!
  if type == .leftMouseDown || type == .leftMouseUp { e.setIntegerValueField(.mouseEventClickState, value: 1) }
  e.post(tap: .cghidEventTap)
  at = p
}
func ease(_ t: Double) -> Double { t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2 }
/** Glide along a slight arc, eased, at 120 events a second; `drag` holds the button. */
func move(to p: CGPoint, _ seconds: Double, drag: Bool = false, arc: Double = 0.08) {
  let a = at, steps = max(2, Int(seconds * 120))
  let mid = CGPoint(x: (a.x + p.x) / 2 - (p.y - a.y) * arc, y: (a.y + p.y) / 2 + (p.x - a.x) * arc)
  for i in 1...steps {
    let t = ease(Double(i) / Double(steps)), u = 1 - t
    let q = CGPoint(x: u * u * a.x + 2 * u * t * mid.x + t * t * p.x, y: u * u * a.y + 2 * u * t * mid.y + t * t * p.y)
    post(drag ? .leftMouseDragged : .mouseMoved, q)
    sleep(seconds / Double(steps))
  }
}
func click(_ p: CGPoint, travel: Double = 0.7) {
  let n = layouts.n
  move(to: p, travel)
  sleep(0.25)
  post(.leftMouseDown, p); sleep(0.07); post(.leftMouseUp, p)
  settle(after: n)
}
/** Scrub a slider from its value through `via` to `to`, as a hand does. */
func scrub(_ name: String, via: [Double], to: Double) {
  guard let r = rect("sliders", name) else { fail("slider \(name) not on screen") }
  move(to: sliderX(name, r["value"]!), 0.7)
  sleep(0.2)
  post(.leftMouseDown, at)
  sleep(0.12)
  for v in via { move(to: sliderX(name, v), 0.55, drag: true, arc: 0); sleep(0.12) }
  move(to: sliderX(name, to), 0.5, drag: true, arc: 0)
  sleep(0.25)
  post(.leftMouseUp, at)
}
/** Synthetic wheel events follow the natural-scrolling setting or not: `k` is measured before recording. */
var k = 1.0
func wheel(down: Double) {
  let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32((-down * k).rounded()), wheel2: 0, wheel3: 0)!
  e.location = at
  e.post(tap: .cghidEventTap)
}
func scrollTop() -> Double { (layouts.latest["scroller"] as? [String: Double])?["top"] ?? 0 }
/** Scroll the panel by `pixels` (down is positive) over `seconds`, eased. */
func scroll(_ pixels: Double, _ seconds: Double = 0.7) {
  let n = layouts.n, steps = max(2, Int(seconds * 60))
  var sent = 0.0
  for i in 1...steps {
    let target = (pixels * ease(Double(i) / Double(steps))).rounded()
    if target != sent { wheel(down: target - sent); sent = target }
    sleep(seconds / Double(steps))
  }
  settle(after: n)
}
/** Scroll the panel so the slider sits at `y` within the window's content. */
func bring(_ name: String, to y: Double) {
  let s = (layouts.latest["sliders"] as? [String: Any])?[name] as? [String: Double]
  guard let now = s?["y"] else { fail("slider \(name) is not in the panel's layout") }
  scroll(now - y)
}

// ---- Before recording: bring the window forward (a background process can't activate an app on
// macOS 14+, a click on its title bar can), the scroll direction, and the cursor's starting place.
settle(quiet: 0.5, limit: 60)
let bounds = windowBounds()
let titleBar = CGPoint(x: bounds["X"]! + bounds["Width"]! / 2, y: bounds["Y"]! + 14)
move(to: titleBar, 0.3)
post(.leftMouseDown, titleBar); sleep(0.07); post(.leftMouseUp, titleBar)
sleep(1.0)
frame = contentFrame()
move(to: screen(980 / 1232 * frame.width + 140, 500), 0.3)
let top0 = scrollTop(), n0 = layouts.n
wheel(down: 40); settle(after: n0, limit: 2)
if scrollTop() <= top0 { k = -1 }
wheel(down: -3000); settle()
let start = screen(frame.width * 0.42, frame.height * 0.55)
move(to: start, 0.5)
sleep(1.0)

// ---- Record the content (2x on Retina) with the cursor, then the take.
let scale = NSScreen.main?.backingScaleFactor ?? 2
let raw = "\(out)/take-raw.mov"
let ffmpeg = Process()
recorder = ffmpeg
ffmpeg.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/ffmpeg")
// -t caps the recording, whatever happens to this script.
ffmpeg.arguments = ["-v", "error", "-y", "-t", "90", "-f", "avfoundation", "-capture_cursor", "1", "-framerate", "60", "-pixel_format", "uyvy422",
  "-i", "Capture screen 0:none",
  "-vf", "crop=\(Int(frame.width * scale)):\(Int(frame.height * scale)):\(Int(frame.minX * scale)):\(Int(frame.minY * scale))",
  "-c:v", "prores_videotoolbox", "-profile:v", "hq", raw]
let pipe = Pipe()
ffmpeg.standardInput = pipe
try! ffmpeg.run()
sleep(2.0)

click(center("buttons", "Choose look"))
sleep(0.3)
click(center("buttons", "Emulsion Neg"), travel: 0.6)
sleep(1.2)
scrub("exposure", via: [1.6, 0.3], to: 0.75)
sleep(0.6)
move(to: CGPoint(x: at.x - 40, y: at.y + 60), 0.4)
bring("shadows", to: 520)
scrub("shadows", via: [48, 8], to: 19)
sleep(0.6)
click(center("buttons", "Refine"))
sleep(0.5)
scrub("halation", via: [40, 6], to: 13)
sleep(0.5)
move(to: CGPoint(x: at.x - 40, y: at.y + 40), 0.4)
bring("grain", to: 560)
scrub("grain", via: [65, 18], to: 31)
sleep(0.5)
move(to: start, 1.0)
sleep(2.5)

pipe.fileHandleForWriting.write("q".data(using: .utf8)!)
ffmpeg.waitUntilExit()
let sliders = layouts.latest["sliders"] as? [String: [String: Double]] ?? [:]
print("hero-cursor: recorded \(raw); halation \(sliders["halation"]?["value"] ?? .nan), grain \(sliders["grain"]?["value"] ?? .nan)")
