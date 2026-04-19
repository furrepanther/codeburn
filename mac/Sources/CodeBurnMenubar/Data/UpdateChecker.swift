import Foundation
import Observation

private let releasesAPI = "https://api.github.com/repos/getagentseal/codeburn/releases/latest"
private let checkIntervalSeconds: TimeInterval = 2 * 24 * 60 * 60
private let lastCheckKey = "UpdateChecker.lastCheckDate"
private let cachedVersionKey = "UpdateChecker.latestVersion"

@MainActor
@Observable
final class UpdateChecker {
    var latestVersion: String?
    var isUpdating = false
    var updateError: String?

    var updateAvailable: Bool {
        guard let latest = latestVersion else { return false }
        let current = currentVersion
        return !current.isEmpty && current != "dev" && latest != current
    }

    var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    }

    func checkIfNeeded() async {
        let lastCheck = UserDefaults.standard.double(forKey: lastCheckKey)
        let now = Date().timeIntervalSince1970
        if now - lastCheck < checkIntervalSeconds {
            latestVersion = UserDefaults.standard.string(forKey: cachedVersionKey)
            return
        }
        await check()
    }

    func check() async {
        guard let url = URL(string: releasesAPI) else { return }
        var request = URLRequest(url: url)
        request.setValue("codeburn-menubar-updater", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            let release = try JSONDecoder().decode(GitHubRelease.self, from: data)
            guard let asset = release.assets.first(where: {
                $0.name.hasPrefix("CodeBurnMenubar-") && $0.name.hasSuffix(".zip")
            }) else { return }

            let version = asset.name
                .replacingOccurrences(of: "CodeBurnMenubar-", with: "")
                .replacingOccurrences(of: ".zip", with: "")

            latestVersion = version
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: lastCheckKey)
            UserDefaults.standard.set(version, forKey: cachedVersionKey)
        } catch {
            NSLog("CodeBurn: update check failed: \(error)")
        }
    }

    func performUpdate() {
        isUpdating = true
        updateError = nil

        let process = CodeburnCLI.makeProcess(subcommand: ["menubar", "--force"])
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            isUpdating = false
            updateError = error.localizedDescription
            NSLog("CodeBurn: update spawn failed: \(error)")
        }
    }
}

private struct GitHubRelease: Decodable {
    let tag_name: String
    let assets: [GitHubAsset]
}

private struct GitHubAsset: Decodable {
    let name: String
    let browser_download_url: String
}
