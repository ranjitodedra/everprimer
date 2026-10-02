import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    // Main storyboard + CAPBridgeViewController are loaded via UISceneStoryboardFile.
    guard let _ = scene as? UIWindowScene else { return }

    if let urlContext = connectionOptions.urlContexts.first {
      _ = ApplicationDelegateProxy.shared.application(
        UIApplication.shared,
        open: urlContext.url,
        options: [:]
      )
    }
    if let activity = connectionOptions.userActivities.first {
      _ = ApplicationDelegateProxy.shared.application(
        UIApplication.shared,
        continue: activity,
        restorationHandler: { _ in }
      )
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else { return }
    _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = ApplicationDelegateProxy.shared.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}
