// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone WKWebView audit surrogate, not the Tauri application. IPC is mocked by the page.
import Cocoa
import WebKit

final class Runner: NSObject, WKNavigationDelegate {
  var window: NSWindow!
  var view: WKWebView!
  var timer: Timer?
  var polls = 0
  func run(_ url: URL) {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: config)
    view.navigationDelegate = self
    window = NSWindow(contentRect: view.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
    window.title = "Emulsion performance audit"
    window.contentView = view
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    view.load(URLRequest(url: url))
    timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [self] _ in
      polls += 1
      if polls > 240 { finish("FAIL: WKWebView timed out", 1); return }
      view.evaluateJavaScript("document.body?.dataset.result ?? null") { result, _ in
        if let text = result as? String { self.finish(text, text.hasPrefix("PASS:") ? 0 : 1) }
      }
    }
  }
  func finish(_ text: String, _ code: Int32) {
    timer?.invalidate()
    print(text)
    fflush(stdout)
    exit(code)
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish("FAIL: WKWebView content process terminated", 1) }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish("FAIL: \(error)", 1) }
}
guard CommandLine.arguments.count == 2, let url = URL(string: CommandLine.arguments[1]) else { fatalError("Usage: wk-run URL") }
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let runner = Runner()
runner.run(url)
app.run()
