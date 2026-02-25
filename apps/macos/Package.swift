// swift-tools-version: 6.2
// Package manifest for the Mayros macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Mayros",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "MayrosIPC", targets: ["MayrosIPC"]),
        .library(name: "MayrosDiscovery", targets: ["MayrosDiscovery"]),
        .executable(name: "Mayros", targets: ["Mayros"]),
        .executable(name: "mayros-mac", targets: ["MayrosMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/MayrosKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "MayrosIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "MayrosDiscovery",
            dependencies: [
                .product(name: "MayrosKit", package: "MayrosKit"),
            ],
            path: "Sources/MayrosDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Mayros",
            dependencies: [
                "MayrosIPC",
                "MayrosDiscovery",
                .product(name: "MayrosKit", package: "MayrosKit"),
                .product(name: "MayrosChatUI", package: "MayrosKit"),
                .product(name: "MayrosProtocol", package: "MayrosKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/Mayros.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "MayrosMacCLI",
            dependencies: [
                "MayrosDiscovery",
                .product(name: "MayrosKit", package: "MayrosKit"),
                .product(name: "MayrosProtocol", package: "MayrosKit"),
            ],
            path: "Sources/MayrosMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "MayrosIPCTests",
            dependencies: [
                "MayrosIPC",
                "Mayros",
                "MayrosDiscovery",
                .product(name: "MayrosProtocol", package: "MayrosKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
