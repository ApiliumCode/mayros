package com.apilium.mayros

import com.google.gson.Gson
import com.google.gson.JsonObject
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.net.URI
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * WebSocket RPC client for the Mayros Gateway.
 *
 * Implements the gateway protocol v3: challenge-response handshake,
 * Ed25519 device identity, token auth, and { type: "req" } RPC format.
 *
 * Usage:
 *   val client = MayrosClient("ws://127.0.0.1:18789")
 *   client.connect()
 *   val result = client.call<ListSessionsResult>("sessions.list", params)
 *   client.disconnect()
 */
class MayrosClient(
    private val url: String,
    private val options: ClientOptions = ClientOptions()
) {
    data class ClientOptions(
        val maxReconnectAttempts: Int = 5,
        val reconnectDelayMs: Long = 3000,
        val requestTimeoutMs: Long = 30000,
        val token: String? = null
    )

    // ========================================================================
    // Types
    // ========================================================================

    data class RpcRequest(
        val type: String = "req",
        val id: String,
        val method: String,
        val params: Any? = null
    )

    data class RpcResponse(
        val type: String? = null,
        val id: String? = null,
        val ok: Boolean? = null,
        val payload: JsonObject? = null,
        val error: JsonObject? = null,
        val event: String? = null
    )

    data class SessionInfo(
        val key: String,
        val displayName: String? = null,
        val model: String? = null,
        val updatedAt: Long? = null
    )

    data class AgentInfo(
        val id: String,
        val name: String? = null,
        val description: String? = null
    )

    data class ChatMessage(
        val sessionKey: String,
        val message: String,
        val idempotencyKey: String? = null
    )

    data class DeviceIdentity(
        val deviceId: String,
        val publicKeyPem: String,
        val privateKeyPem: String
    )

    // ========================================================================
    // State
    // ========================================================================

    private val log = Logger.getInstance(MayrosClient::class.java)
    private val gson = Gson()
    @Volatile private var ws: WebSocketClient? = null
    @Volatile private var connected = false
    @Volatile private var handshakeCompleted = false
    @Volatile private var reconnectAttempts = 0
    private val pendingRequests = ConcurrentHashMap<String, PendingRequest>()
    private val eventListeners = ConcurrentHashMap<String, CopyOnWriteArrayList<(JsonObject) -> Unit>>()
    @Volatile private var connectLatch: CountDownLatch? = null
    private val reconnectExecutor: ScheduledExecutorService =
        Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "mayros-reconnect").apply { isDaemon = true } }
    @Volatile private var reconnectFuture: ScheduledFuture<*>? = null
    private var deviceIdentity: DeviceIdentity? = null

    private data class PendingRequest(
        val latch: CountDownLatch,
        var result: JsonObject? = null,
        var error: String? = null
    )

    val isConnected: Boolean get() = connected && handshakeCompleted

    init {
        deviceIdentity = loadDeviceIdentity()
    }

    // ========================================================================
    // Device identity
    // ========================================================================

    private fun loadDeviceIdentity(): DeviceIdentity? {
        return try {
            val home = System.getProperty("user.home")
            val file = File(home, ".mayros/identity/device.json")
            if (!file.exists()) return null
            val raw = gson.fromJson(file.readText(), JsonObject::class.java)
            if (raw?.get("version")?.asInt != 1) return null
            val deviceId = raw.get("deviceId")?.asString ?: return null
            val publicKeyPem = raw.get("publicKeyPem")?.asString ?: return null
            val privateKeyPem = raw.get("privateKeyPem")?.asString ?: return null
            DeviceIdentity(deviceId, publicKeyPem, privateKeyPem)
        } catch (e: Exception) {
            log.debug("Failed to load device identity: ${e.message}")
            null
        }
    }

    internal fun buildDeviceAuthPayload(
        deviceId: String,
        clientId: String,
        clientMode: String,
        role: String,
        scopes: List<String>,
        signedAtMs: Long,
        token: String?,
        nonce: String?
    ): String {
        val version = if (nonce != null) "v2" else "v1"
        val parts = mutableListOf(
            version,
            deviceId,
            clientId,
            clientMode,
            role,
            scopes.joinToString(","),
            signedAtMs.toString(),
            token ?: ""
        )
        if (version == "v2") {
            parts.add(nonce ?: "")
        }
        return parts.joinToString("|")
    }

    private fun signPayload(privateKeyPem: String, payload: String): String {
        val pemBody = privateKeyPem
            .replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replace("\\s".toRegex(), "")
        val keyBytes = Base64.getDecoder().decode(pemBody)
        val keySpec = PKCS8EncodedKeySpec(keyBytes)
        val keyFactory = KeyFactory.getInstance("Ed25519")
        val privateKey = keyFactory.generatePrivate(keySpec)
        val signature = Signature.getInstance("Ed25519")
        signature.initSign(privateKey)
        signature.update(payload.toByteArray(Charsets.UTF_8))
        val sig = signature.sign()
        return base64UrlEncode(sig)
    }

    private fun derivePublicKeyRaw(publicKeyPem: String): String {
        val pemBody = publicKeyPem
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replace("\\s".toRegex(), "")
        val keyBytes = Base64.getDecoder().decode(pemBody)
        val keySpec = X509EncodedKeySpec(keyBytes)
        val keyFactory = KeyFactory.getInstance("Ed25519")
        val publicKey = keyFactory.generatePublic(keySpec)
        val spki = publicKey.encoded // DER-encoded SPKI
        // Ed25519 SPKI is 44 bytes: 12-byte prefix + 32-byte raw key
        val rawKey = if (spki.size == 44) spki.copyOfRange(12, 44) else spki
        return base64UrlEncode(rawKey)
    }

    private fun base64UrlEncode(data: ByteArray): String {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(data)
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    @Synchronized
    fun connect(): Boolean {
        val latch = CountDownLatch(1)
        connectLatch = latch
        handshakeCompleted = false
        createWebSocket()
        ws?.connect()
        return latch.await(options.requestTimeoutMs, TimeUnit.MILLISECONDS) && isConnected
    }

    @Synchronized
    fun disconnect() {
        reconnectFuture?.cancel(false)
        reconnectFuture = null
        connected = false
        handshakeCompleted = false
        ws?.close()
        ws = null
        // Reject all pending requests
        val snapshot = ArrayList(pendingRequests.values)
        pendingRequests.clear()
        for (pending in snapshot) {
            pending.error = "disconnected"
            pending.latch.countDown()
        }
    }

    fun dispose() {
        reconnectFuture?.cancel(false)
        reconnectFuture = null
        disconnect()
        reconnectExecutor.shutdown()
        try {
            reconnectExecutor.awaitTermination(2, TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
            reconnectExecutor.shutdownNow()
        }
        eventListeners.clear()
    }

    private fun createWebSocket() {
        val uri = URI(url)
        ws = object : WebSocketClient(uri) {
            override fun onOpen(handshake: ServerHandshake?) {
                connected = true
                reconnectAttempts = 0
                // Handshake starts — wait for connect.challenge event
            }

            override fun onMessage(message: String?) {
                message?.let { handleMessage(it) }
            }

            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                connected = false
                handshakeCompleted = false
                connectLatch?.countDown()
                if (remote && reconnectAttempts < options.maxReconnectAttempts) {
                    scheduleReconnect()
                }
            }

            override fun onError(ex: Exception?) {
                log.debug("WebSocket error: ${ex?.message}")
                connectLatch?.countDown()
            }
        }
    }

    private fun scheduleReconnect() {
        reconnectAttempts++
        val delay = options.reconnectDelayMs * (1L shl (reconnectAttempts - 1).coerceAtMost(4))
        reconnectFuture?.cancel(false)
        reconnectFuture = reconnectExecutor.schedule({
            if (!connected) {
                createWebSocket()
                ws?.connect()
            }
        }, delay, TimeUnit.MILLISECONDS)
    }

    // ========================================================================
    // Handshake (protocol v3)
    // ========================================================================

    /**
     * Session keys and client identity are process-scoped and do not rotate.
     * This is acceptable for IDE plugins: the WebSocket connection is tied to
     * the IDE process lifetime, and each new IDE launch creates a fresh
     * connection with a new handshake timestamp.  The gateway enforces its
     * own session timeouts server-side, so client-side rotation is unnecessary.
     */
    private fun performHandshake(nonce: String?) {
        val clientId = "gateway-client"
        val clientMode = "ui"
        val role = "operator"
        val scopes = listOf("operator.read", "operator.write")
        val handshakeId = "handshake-${System.currentTimeMillis()}"
        val signedAtMs = System.currentTimeMillis()

        val params = mutableMapOf<String, Any>(
            "minProtocol" to 3,
            "maxProtocol" to 3,
            "client" to mapOf(
                "id" to clientId,
                "version" to "0.1.0",
                "platform" to "jetbrains",
                "mode" to clientMode
            ),
            "caps" to emptyList<String>(),
            "commands" to emptyList<String>(),
            "role" to role,
            "scopes" to scopes
        )

        // Token auth
        val token = options.token?.takeIf { it.isNotBlank() }
        if (token != null) {
            params["auth"] = mapOf("token" to token)
        }

        // Device identity
        val device = deviceIdentity
        if (device != null) {
            try {
                val payload = buildDeviceAuthPayload(
                    deviceId = device.deviceId,
                    clientId = clientId,
                    clientMode = clientMode,
                    role = role,
                    scopes = scopes,
                    signedAtMs = signedAtMs,
                    token = token,
                    nonce = nonce
                )
                val signature = signPayload(device.privateKeyPem, payload)
                val deviceParams = mutableMapOf<String, Any>(
                    "id" to device.deviceId,
                    "publicKey" to derivePublicKeyRaw(device.publicKeyPem),
                    "signature" to signature,
                    "signedAt" to signedAtMs
                )
                if (nonce != null) {
                    deviceParams["nonce"] = nonce
                }
                params["device"] = deviceParams
            } catch (e: Exception) {
                log.warn("Failed to sign device payload: ${e.message}")
            }
        }

        val request = RpcRequest(
            type = "req",
            id = handshakeId,
            method = "connect",
            params = params
        )

        // Store the handshake id so handleMessage can detect the response
        pendingHandshakeId = handshakeId
        ws?.send(gson.toJson(request))
    }

    @Volatile private var pendingHandshakeId: String? = null

    // ========================================================================
    // Message handling
    // ========================================================================

    private fun handleMessage(raw: String) {
        val parsed = try {
            gson.fromJson(raw, JsonObject::class.java)
        } catch (e: Exception) {
            log.warn("Failed to parse WebSocket message", e)
            return
        }

        val type = parsed.get("type")?.asString

        // During handshake phase: intercept connect.challenge and connect response
        if (!handshakeCompleted) {
            // connect.challenge event
            if (type == "event") {
                val eventName = parsed.get("event")?.asString
                if (eventName == "connect.challenge") {
                    val payload = parsed.getAsJsonObject("payload")
                    val nonce = payload?.get("nonce")?.asString
                    performHandshake(nonce)
                    return
                }
            }

            // connect response
            if (type == "res" && parsed.get("id")?.asString == pendingHandshakeId) {
                pendingHandshakeId = null
                val ok = parsed.get("ok")?.asBoolean == true
                if (ok) {
                    handshakeCompleted = true
                    connectLatch?.countDown()
                    log.info("Gateway handshake completed")
                } else {
                    val error = parsed.getAsJsonObject("error")
                    val msg = error?.get("message")?.asString ?: "Handshake rejected"
                    log.warn("Gateway handshake failed: $msg")
                    connected = false
                    connectLatch?.countDown()
                }
                return
            }
        }

        // Event message: { type: "event", event: "...", payload: {...} }
        if (type == "event" || type == "evt") {
            val eventName = parsed.get("event")?.asString ?: return
            val payload = parsed.getAsJsonObject("payload") ?: JsonObject()
            val listeners = eventListeners[eventName]
            listeners?.forEach { it(payload) }
            return
        }

        // RPC response: { type: "res", id, ok, payload, error }
        if (type == "res") {
            val id = parsed.get("id")?.asString ?: return
            val pending = pendingRequests.remove(id) ?: return

            val ok = parsed.get("ok")?.asBoolean
            if (ok == false || parsed.has("error")) {
                val error = parsed.getAsJsonObject("error")
                pending.error = error?.toString() ?: "Unknown error"
            } else {
                pending.result = parsed.getAsJsonObject("payload")
            }
            pending.latch.countDown()
        }
    }

    // ========================================================================
    // RPC
    // ========================================================================

    /**
     * Send an RPC request and wait for the response.
     * Method names use dots: sessions.list, chat.send, etc.
     */
    fun <T> call(method: String, params: Any? = null, resultClass: Class<T>): T? {
        val id = UUID.randomUUID().toString()
        val request = RpcRequest(type = "req", id = id, method = method, params = params)
        val pending = PendingRequest(CountDownLatch(1))
        pendingRequests[id] = pending

        val json = gson.toJson(request)
        ws?.send(json) ?: throw IllegalStateException("Not connected")

        if (!pending.latch.await(options.requestTimeoutMs, TimeUnit.MILLISECONDS)) {
            pendingRequests.remove(id)
            throw RuntimeException("Request timed out: $method")
        }

        if (pending.error != null) {
            throw RuntimeException("RPC error: ${pending.error}")
        }

        return pending.result?.let { gson.fromJson(it, resultClass) }
    }

    /**
     * Send an RPC request without waiting for a typed result.
     */
    fun callRaw(method: String, params: Any? = null): JsonObject? {
        return call(method, params, JsonObject::class.java)
    }

    // ========================================================================
    // Event subscription
    // ========================================================================

    fun on(event: String, listener: (JsonObject) -> Unit) {
        eventListeners.getOrPut(event) { CopyOnWriteArrayList() }.add(listener)
    }

    fun off(event: String, listener: (JsonObject) -> Unit) {
        eventListeners[event]?.remove(listener)
    }

    // ========================================================================
    // Domain methods
    // ========================================================================

    data class ListSessionsResult(val sessions: List<SessionInfo>)
    data class ListAgentsResult(val agents: List<AgentInfo>)
    data class SendChatResult(val runId: String?)
    data class HealthResult(val status: String, val version: String?)
    data class ChatHistoryResult(val messages: List<JsonObject>)

    data class SkillInfo(
        val name: String,
        val status: String,
        val queryCount: Int,
        val lastUsedAt: String? = null
    )
    data class SkillsResult(val skills: List<SkillInfo>)

    data class PlanInfo(
        val id: String,
        val phase: String,
        val discoveries: List<JsonObject>,
        val assertions: List<JsonObject>,
        val createdAt: String
    )

    data class TraceEvent(
        val id: String,
        val type: String,
        val agentId: String,
        val timestamp: String,
        val data: JsonObject? = null,
        val parentId: String? = null
    )
    data class TraceEventsResult(val events: List<TraceEvent>)

    data class KgEntry(
        val subject: String,
        val predicate: String,
        val objectValue: String,
        val id: String
    )
    data class KgResult(val entries: List<KgEntry>)

    fun listSessions(): List<SessionInfo> {
        val result = call("sessions.list", null, ListSessionsResult::class.java)
        return result?.sessions ?: emptyList()
    }

    fun getChatHistory(sessionKey: String): List<JsonObject> {
        val result = call("chat.history", mapOf("sessionKey" to sessionKey), ChatHistoryResult::class.java)
        return result?.messages ?: emptyList()
    }

    fun sendMessage(message: ChatMessage): String? {
        val result = call("chat.send", message, SendChatResult::class.java)
        return result?.runId
    }

    fun abortChat(sessionKey: String) {
        callRaw("chat.abort", mapOf("sessionKey" to sessionKey))
    }

    fun listAgents(): List<AgentInfo> {
        val result = call("agents.list", null, ListAgentsResult::class.java)
        return result?.agents ?: emptyList()
    }

    fun getHealth(): HealthResult? {
        return call("health", null, HealthResult::class.java)
    }

    fun getSkillsStatus(): List<SkillInfo> {
        val result = call("skills.status", null, SkillsResult::class.java)
        return result?.skills ?: emptyList()
    }

    fun getPlan(sessionId: String): JsonObject? {
        return callRaw("plan.get", mapOf("sessionId" to sessionId))
    }

    fun getTraceEvents(agentId: String? = null, limit: Int = 100): List<JsonObject> {
        val params = mutableMapOf<String, Any>("limit" to limit)
        if (agentId != null) params["agentId"] = agentId
        val result = callRaw("trace.events", params)
        val events = result?.getAsJsonArray("events")
        return events?.map { it.asJsonObject } ?: emptyList()
    }

    fun queryKg(query: String, limit: Int = 50): List<KgEntry> {
        val result = call("kg.query", mapOf("query" to query, "limit" to limit), KgResult::class.java)
        return result?.entries ?: emptyList()
    }
}
