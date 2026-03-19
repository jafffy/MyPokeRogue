import SwiftUI
import WebKit

// MARK: - Configuration

enum GameMode {
    /// Connect to a streaming server (thin client)
    case streaming(serverURL: String)
    /// Load the game directly in WebView
    case direct(gameURL: String)
}

// Change this to switch between modes
let activeMode: GameMode = .streaming(serverURL: "http://localhost:3000")

// MARK: - ContentView

struct ContentView: View {
    var body: some View {
        Group {
            switch activeMode {
            case .streaming(let serverURL):
                StreamingClientView(serverURL: serverURL)
            case .direct(let gameURL):
                WebView(url: URL(string: gameURL)!)
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: - Streaming Client View (thin client mode)

struct StreamingClientView: View {
    let serverURL: String

    var body: some View {
        WebView(url: URL(string: serverURL)!)
    }
}

// MARK: - WebView

struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // Allow WebSocket connections
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false

        // Allow insecure localhost for development
        webView.navigationDelegate = context.coordinator

        let request = URLRequest(url: url)
        webView.load(request)

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            didReceive challenge: URLAuthenticationChallenge,
            completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
        ) {
            // Accept self-signed certs for local development
            if challenge.protectionSpace.host == "localhost" || challenge.protectionSpace.host == "127.0.0.1" {
                let credential = URLCredential(trust: challenge.protectionSpace.serverTrust!)
                completionHandler(.useCredential, credential)
            } else {
                completionHandler(.performDefaultHandling, nil)
            }
        }
    }
}

#Preview {
    ContentView()
}
