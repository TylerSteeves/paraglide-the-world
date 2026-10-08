import SwiftUI
import WebKit
import CoreMotion

struct ContentView: View {
    @State private var serverUrlString: String = "http://192.168.40.141:5173/"
    @State private var showingSettings: Bool = false
    @State private var webView = WKWebView()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            ParaglideWebView(urlString: serverUrlString, webView: webView)
                .ignoresSafeArea()

            // 3-finger tap gesture detector overlay (invisible)
            Color.clear
                .contentShape(Rectangle())
                .gesture(
                    TapGesture(count: 2)
                        .onEnded {
                            // double tap with 2 fingers or long press can open config
                        }
                )
                .allowsHitTesting(false)
        }
        .sheet(isPresented: $showingSettings) {
            ServerConfigView(urlString: $serverUrlString, onReload: {
                if let url = URL(string: serverUrlString) {
                    webView.load(URLRequest(url: url))
                }
            })
        }
    }
}

struct ParaglideWebView: UIViewRepresentable {
    let urlString: String
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView {
        let config = webView.configuration
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true

        // Register native Taptic Engine & CoreMotion bridge
        config.userContentController.removeScriptMessageHandler(forName: "haptic")
        config.userContentController.add(context.coordinator, name: "haptic")
        config.userContentController.removeScriptMessageHandler(forName: "motion")
        config.userContentController.add(context.coordinator, name: "motion")

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = true
        webView.backgroundColor = .black
        webView.navigationDelegate = context.coordinator

        loadTarget(in: webView)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // No-op to avoid restarting game on view updates
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    private func loadTarget(in view: WKWebView) {
        if let url = URL(string: urlString) {
            var request = URLRequest(url: url, timeoutInterval: 4.0)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            view.load(request)
        } else {
            loadBundledDist(in: view)
        }
    }

    private func loadBundledDist(in view: WKWebView) {
        if let bundleUrl = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "dist") {
            view.loadFileURL(bundleUrl, allowingReadAccessTo: bundleUrl.deletingLastPathComponent())
        }
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: ParaglideWebView
        private let lightFeedback = UIImpactFeedbackGenerator(style: .light)
        private let mediumFeedback = UIImpactFeedbackGenerator(style: .medium)
        private let heavyFeedback = UIImpactFeedbackGenerator(style: .heavy)
        private let rigidFeedback = UIImpactFeedbackGenerator(style: .rigid)
        private let softFeedback = UIImpactFeedbackGenerator(style: .soft)
        private let selectionFeedback = UISelectionFeedbackGenerator()
        private let motionManager = CMMotionManager()
        private var isStreamingMotion: Bool = false

        init(_ parent: ParaglideWebView) {
            self.parent = parent
            super.init()
            lightFeedback.prepare()
            mediumFeedback.prepare()
            heavyFeedback.prepare()
            rigidFeedback.prepare()
            softFeedback.prepare()
            selectionFeedback.prepare()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "haptic" {
                if let type = message.body as? String {
                    triggerHaptic(type: type)
                } else if let dict = message.body as? [String: Any], let type = dict["type"] as? String {
                    triggerHaptic(type: type, intensity: dict["intensity"] as? Double)
                }
            } else if message.name == "motion" {
                if let cmd = message.body as? String {
                    if cmd == "start" {
                        startMotionUpdates()
                    } else if cmd == "stop" {
                        stopMotionUpdates()
                    }
                }
            }
        }

        func startMotionUpdates() {
            guard motionManager.isDeviceMotionAvailable, !isStreamingMotion else { return }
            motionManager.deviceMotionUpdateInterval = 1.0 / 60.0
            isStreamingMotion = true
            motionManager.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: .main) { [weak self] motion, error in
                guard let self = self, let motion = motion else { return }
                let roll = motion.attitude.roll
                let pitch = motion.attitude.pitch
                let yaw = motion.attitude.yaw
                let ax = motion.userAcceleration.x
                let ay = motion.userAcceleration.y
                let az = motion.userAcceleration.z
                let rx = motion.rotationRate.x
                let ry = motion.rotationRate.y
                let rz = motion.rotationRate.z
                let gx = motion.gravity.x
                let gy = motion.gravity.y
                let gz = motion.gravity.z

                let js = "window.onNativeMotion && window.onNativeMotion({ roll: \(roll), pitch: \(pitch), yaw: \(yaw), ax: \(ax), ay: \(ay), az: \(az), rx: \(rx), ry: \(ry), rz: \(rz), gx: \(gx), gy: \(gy), gz: \(gz) });"
                self.parent.webView.evaluateJavaScript(js, completionHandler: nil)
            }
        }

        func stopMotionUpdates() {
            if isStreamingMotion {
                motionManager.stopDeviceMotionUpdates()
                isStreamingMotion = false
            }
        }

        private func triggerHaptic(type: String, intensity: Double? = nil) {
            DispatchQueue.main.async { [self] in
                switch type {
                case "tick", "notch":
                    selectionFeedback.selectionChanged()
                    selectionFeedback.prepare()
                case "light":
                    if let intensity = intensity {
                        lightFeedback.impactOccurred(intensity: CGFloat(intensity))
                    } else {
                        lightFeedback.impactOccurred()
                    }
                    lightFeedback.prepare()
                case "medium":
                    if let intensity = intensity {
                        mediumFeedback.impactOccurred(intensity: CGFloat(intensity))
                    } else {
                        mediumFeedback.impactOccurred()
                    }
                    mediumFeedback.prepare()
                case "heavy":
                    heavyFeedback.impactOccurred()
                    heavyFeedback.prepare()
                case "rigid", "snap":
                    rigidFeedback.impactOccurred()
                    rigidFeedback.prepare()
                case "thermalKick":
                    heavyFeedback.impactOccurred(intensity: 1.0)
                    heavyFeedback.prepare()
                case "soft", "stallRelease":
                    softFeedback.impactOccurred()
                    softFeedback.prepare()
                default:
                    selectionFeedback.selectionChanged()
                    selectionFeedback.prepare()
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            startMotionUpdates()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("[ParaglideTheWorld] Remote dev server connection failed: \(error.localizedDescription). Falling back to local bundle.")
            parent.loadBundledDist(in: webView)
        }

        deinit {
            stopMotionUpdates()
        }
    }
}

struct ServerConfigView: View {
    @Binding var urlString: String
    var onReload: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Dev Server URL")) {
                    TextField("http://192.168.40.141:5173/", text: $urlString)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }

                Section {
                    Button("Reload Flight View") {
                        onReload()
                        dismiss()
                    }
                    Button("Use Local Bundled Build") {
                        urlString = "bundled"
                        onReload()
                        dismiss()
                    }
                }
            }
            .navigationTitle("Connection Settings")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
