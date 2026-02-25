import Foundation

// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-mayros writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = "ai.mayros.mac"
let gatewayLaunchdLabel = "ai.mayros.gateway"
let onboardingVersionKey = "mayros.onboardingVersion"
let onboardingSeenKey = "mayros.onboardingSeen"
let currentOnboardingVersion = 7
let pauseDefaultsKey = "mayros.pauseEnabled"
let iconAnimationsEnabledKey = "mayros.iconAnimationsEnabled"
let swabbleEnabledKey = "mayros.swabbleEnabled"
let swabbleTriggersKey = "mayros.swabbleTriggers"
let voiceWakeTriggerChimeKey = "mayros.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "mayros.voiceWakeSendChime"
let showDockIconKey = "mayros.showDockIcon"
let defaultVoiceWakeTriggers = ["mayros"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "mayros.voiceWakeMicID"
let voiceWakeMicNameKey = "mayros.voiceWakeMicName"
let voiceWakeLocaleKey = "mayros.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "mayros.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "mayros.voicePushToTalkEnabled"
let talkEnabledKey = "mayros.talkEnabled"
let iconOverrideKey = "mayros.iconOverride"
let connectionModeKey = "mayros.connectionMode"
let remoteTargetKey = "mayros.remoteTarget"
let remoteIdentityKey = "mayros.remoteIdentity"
let remoteProjectRootKey = "mayros.remoteProjectRoot"
let remoteCliPathKey = "mayros.remoteCliPath"
let canvasEnabledKey = "mayros.canvasEnabled"
let cameraEnabledKey = "mayros.cameraEnabled"
let systemRunPolicyKey = "mayros.systemRunPolicy"
let systemRunAllowlistKey = "mayros.systemRunAllowlist"
let systemRunEnabledKey = "mayros.systemRunEnabled"
let locationModeKey = "mayros.locationMode"
let locationPreciseKey = "mayros.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "mayros.peekabooBridgeEnabled"
let deepLinkKeyKey = "mayros.deepLinkKey"
let modelCatalogPathKey = "mayros.modelCatalogPath"
let modelCatalogReloadKey = "mayros.modelCatalogReload"
let cliInstallPromptedVersionKey = "mayros.cliInstallPromptedVersion"
let heartbeatsEnabledKey = "mayros.heartbeatsEnabled"
let debugPaneEnabledKey = "mayros.debugPaneEnabled"
let debugFileLogEnabledKey = "mayros.debug.fileLogEnabled"
let appLogLevelKey = "mayros.debug.appLogLevel"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
