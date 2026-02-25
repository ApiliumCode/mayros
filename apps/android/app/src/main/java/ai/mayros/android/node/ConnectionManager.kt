package ai.mayros.android.node

import android.os.Build
import ai.mayros.android.BuildConfig
import ai.mayros.android.SecurePrefs
import ai.mayros.android.gateway.GatewayClientInfo
import ai.mayros.android.gateway.GatewayConnectOptions
import ai.mayros.android.gateway.GatewayEndpoint
import ai.mayros.android.gateway.GatewayTlsParams
import ai.mayros.android.protocol.MayrosCanvasA2UICommand
import ai.mayros.android.protocol.MayrosCanvasCommand
import ai.mayros.android.protocol.MayrosCameraCommand
import ai.mayros.android.protocol.MayrosLocationCommand
import ai.mayros.android.protocol.MayrosScreenCommand
import ai.mayros.android.protocol.MayrosSmsCommand
import ai.mayros.android.protocol.MayrosCapability
import ai.mayros.android.LocationMode
import ai.mayros.android.VoiceWakeMode

class ConnectionManager(
  private val prefs: SecurePrefs,
  private val cameraEnabled: () -> Boolean,
  private val locationMode: () -> LocationMode,
  private val voiceWakeMode: () -> VoiceWakeMode,
  private val smsAvailable: () -> Boolean,
  private val hasRecordAudioPermission: () -> Boolean,
  private val manualTls: () -> Boolean,
) {
  companion object {
    internal fun resolveTlsParamsForEndpoint(
      endpoint: GatewayEndpoint,
      storedFingerprint: String?,
      manualTlsEnabled: Boolean,
    ): GatewayTlsParams? {
      val stableId = endpoint.stableId
      val stored = storedFingerprint?.trim().takeIf { !it.isNullOrEmpty() }
      val isManual = stableId.startsWith("manual|")

      if (isManual) {
        if (!manualTlsEnabled) return null
        if (!stored.isNullOrBlank()) {
          return GatewayTlsParams(
            required = true,
            expectedFingerprint = stored,
            allowTOFU = false,
            stableId = stableId,
          )
        }
        return GatewayTlsParams(
          required = true,
          expectedFingerprint = null,
          allowTOFU = false,
          stableId = stableId,
        )
      }

      // Prefer stored pins. Never let discovery-provided TXT override a stored fingerprint.
      if (!stored.isNullOrBlank()) {
        return GatewayTlsParams(
          required = true,
          expectedFingerprint = stored,
          allowTOFU = false,
          stableId = stableId,
        )
      }

      val hinted = endpoint.tlsEnabled || !endpoint.tlsFingerprintSha256.isNullOrBlank()
      if (hinted) {
        // TXT is unauthenticated. Do not treat the advertised fingerprint as authoritative.
        return GatewayTlsParams(
          required = true,
          expectedFingerprint = null,
          allowTOFU = false,
          stableId = stableId,
        )
      }

      return null
    }
  }

  fun buildInvokeCommands(): List<String> =
    buildList {
      add(MayrosCanvasCommand.Present.rawValue)
      add(MayrosCanvasCommand.Hide.rawValue)
      add(MayrosCanvasCommand.Navigate.rawValue)
      add(MayrosCanvasCommand.Eval.rawValue)
      add(MayrosCanvasCommand.Snapshot.rawValue)
      add(MayrosCanvasA2UICommand.Push.rawValue)
      add(MayrosCanvasA2UICommand.PushJSONL.rawValue)
      add(MayrosCanvasA2UICommand.Reset.rawValue)
      add(MayrosScreenCommand.Record.rawValue)
      if (cameraEnabled()) {
        add(MayrosCameraCommand.Snap.rawValue)
        add(MayrosCameraCommand.Clip.rawValue)
      }
      if (locationMode() != LocationMode.Off) {
        add(MayrosLocationCommand.Get.rawValue)
      }
      if (smsAvailable()) {
        add(MayrosSmsCommand.Send.rawValue)
      }
      if (BuildConfig.DEBUG) {
        add("debug.logs")
        add("debug.ed25519")
      }
      add("app.update")
    }

  fun buildCapabilities(): List<String> =
    buildList {
      add(MayrosCapability.Canvas.rawValue)
      add(MayrosCapability.Screen.rawValue)
      if (cameraEnabled()) add(MayrosCapability.Camera.rawValue)
      if (smsAvailable()) add(MayrosCapability.Sms.rawValue)
      if (voiceWakeMode() != VoiceWakeMode.Off && hasRecordAudioPermission()) {
        add(MayrosCapability.VoiceWake.rawValue)
      }
      if (locationMode() != LocationMode.Off) {
        add(MayrosCapability.Location.rawValue)
      }
    }

  fun resolvedVersionName(): String {
    val versionName = BuildConfig.VERSION_NAME.trim().ifEmpty { "dev" }
    return if (BuildConfig.DEBUG && !versionName.contains("dev", ignoreCase = true)) {
      "$versionName-dev"
    } else {
      versionName
    }
  }

  fun resolveModelIdentifier(): String? {
    return listOfNotNull(Build.MANUFACTURER, Build.MODEL)
      .joinToString(" ")
      .trim()
      .ifEmpty { null }
  }

  fun buildUserAgent(): String {
    val version = resolvedVersionName()
    val release = Build.VERSION.RELEASE?.trim().orEmpty()
    val releaseLabel = if (release.isEmpty()) "unknown" else release
    return "MayrosAndroid/$version (Android $releaseLabel; SDK ${Build.VERSION.SDK_INT})"
  }

  fun buildClientInfo(clientId: String, clientMode: String): GatewayClientInfo {
    return GatewayClientInfo(
      id = clientId,
      displayName = prefs.displayName.value,
      version = resolvedVersionName(),
      platform = "android",
      mode = clientMode,
      instanceId = prefs.instanceId.value,
      deviceFamily = "Android",
      modelIdentifier = resolveModelIdentifier(),
    )
  }

  fun buildNodeConnectOptions(): GatewayConnectOptions {
    return GatewayConnectOptions(
      role = "node",
      scopes = emptyList(),
      caps = buildCapabilities(),
      commands = buildInvokeCommands(),
      permissions = emptyMap(),
      client = buildClientInfo(clientId = "mayros-android", clientMode = "node"),
      userAgent = buildUserAgent(),
    )
  }

  fun buildOperatorConnectOptions(): GatewayConnectOptions {
    return GatewayConnectOptions(
      role = "operator",
      scopes = listOf("operator.read", "operator.write", "operator.talk.secrets"),
      caps = emptyList(),
      commands = emptyList(),
      permissions = emptyMap(),
      client = buildClientInfo(clientId = "mayros-control-ui", clientMode = "ui"),
      userAgent = buildUserAgent(),
    )
  }

  fun resolveTlsParams(endpoint: GatewayEndpoint): GatewayTlsParams? {
    val stored = prefs.loadGatewayTlsFingerprint(endpoint.stableId)
    return resolveTlsParamsForEndpoint(endpoint, storedFingerprint = stored, manualTlsEnabled = manualTls())
  }
}
