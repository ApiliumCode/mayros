// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "MayrosKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "MayrosProtocol", targets: ["MayrosProtocol"]),
        .library(name: "MayrosKit", targets: ["MayrosKit"]),
        .library(name: "MayrosChatUI", targets: ["MayrosChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    ],
    targets: [
        .target(
            name: "MayrosProtocol",
            path: "Sources/MayrosProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "MayrosKit",
            dependencies: [
                "MayrosProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/MayrosKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "MayrosChatUI",
            dependencies: [
                "MayrosKit",
                .product(
                    name: "Textual",
                    package: "textual",
                    condition: .when(platforms: [.macOS, .iOS])),
            ],
            path: "Sources/MayrosChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "MayrosKitTests",
            dependencies: ["MayrosKit", "MayrosChatUI"],
            path: "Tests/MayrosKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
