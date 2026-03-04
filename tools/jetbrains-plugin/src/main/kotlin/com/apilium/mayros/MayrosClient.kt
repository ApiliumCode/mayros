package com.apilium.mayros

import com.google.gson.Gson
import com.google.gson.JsonObject
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import com.intellij.openapi.diagnostic.Logger
import java.net.URI
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * WebSocket RPC client for the Mayros Gateway.
 *
 * Mirrors the VSCode extension's MayrosClient — same JSON-RPC protocol.
 *
 * Usage:
 *   val client = MayrosClient("ws://127.0.0.1:18789")
 *   client.connect()
 *   val result = client.call<ListSessionsResult>("sessions/list", params)
 *   client.disconnect()
 */
class MayrosClient(
    private val url: String,
    private val options: ClientOptions = ClientOptions()
) {
    data class ClientOptions(
        val maxReconnectAttempts: Int = 5,
        val reconnectDelayMs: Long = 3000,
        val requestTimeoutMs: Long = 30000
    )

    // ========================================================================
    // Types
    // ========================================================================

    data class RpcRequest(
        val id: String,
        val method: String,
        val params: Any? = null
    )

    data class RpcResponse(
        val id: String? = null,
        val result: JsonObject? = null,
        val error: JsonObject? = null,
        val event: String? = null,
        val payload: JsonObject? = null
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
        val thinking: String? = null,
        val runId: String? = null
    )

    // ========================================================================
    // State
    // ========================================================================

    private val log = Logger.getInstance(MayrosClient::class.java)
    private val gson = Gson()
    private var ws: WebSocketClient? = null
    private var connected = false
    private var reconnectAttempts = 0
    private val pendingRequests = ConcurrentHashMap<String, PendingRequest>()
    private val eventListeners = ConcurrentHashMap<String, MutableList<(JsonObject) -> Unit>>()
    private var connectLatch: CountDownLatch? = null
    private var reconnectTimer: Timer? = null

    private data class PendingRequest(
        val latch: CountDownLatch,
        var result: JsonObject? = null,
        var error: String? = null
    )

    val isConnected: Boolean get() = connected

    // ========================================================================
    // Lifecycle
    // ========================================================================

    fun connect(): Boolean {
        connectLatch = CountDownLatch(1)
        createWebSocket()
        ws?.connect()
        return connectLatch?.await(options.requestTimeoutMs, TimeUnit.MILLISECONDS) == true && connected
    }

    fun disconnect() {
        connected = false
        ws?.close()
        ws = null
        // Reject all pending requests
        pendingRequests.forEach { (_, pending) ->
            pending.error = "disconnected"
            pending.latch.countDown()
        }
        pendingRequests.clear()
    }

    fun dispose() {
        reconnectTimer?.cancel()
        reconnectTimer = null
        disconnect()
        eventListeners.clear()
    }

    private fun createWebSocket() {
        val uri = URI(url)
        ws = object : WebSocketClient(uri) {
            override fun onOpen(handshake: ServerHandshake?) {
                connected = true
                reconnectAttempts = 0
                connectLatch?.countDown()
            }

            override fun onMessage(message: String?) {
                message?.let { handleMessage(it) }
            }

            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                connected = false
                if (remote && reconnectAttempts < options.maxReconnectAttempts) {
                    scheduleReconnect()
                }
            }

            override fun onError(ex: Exception?) {
                connectLatch?.countDown()
            }
        }
    }

    private fun scheduleReconnect() {
        reconnectAttempts++
        val delay = options.reconnectDelayMs * (1L shl (reconnectAttempts - 1).coerceAtMost(4))
        reconnectTimer?.cancel()
        reconnectTimer = Timer().also { timer ->
            timer.schedule(object : TimerTask() {
                override fun run() {
                    if (!connected) {
                        createWebSocket()
                        ws?.connect()
                    }
                }
            }, delay)
        }
    }

    // ========================================================================
    // Message handling
    // ========================================================================

    private fun handleMessage(raw: String) {
        val response = try {
            gson.fromJson(raw, RpcResponse::class.java)
        } catch (e: Exception) {
            log.warn("Failed to parse WebSocket message", e)
            return
        }

        // Event message
        if (response.event != null && response.payload != null) {
            val listeners = eventListeners[response.event]
            listeners?.forEach { it(response.payload) }
            return
        }

        // RPC response
        val id = response.id ?: return
        val pending = pendingRequests.remove(id) ?: return

        if (response.error != null) {
            pending.error = response.error.toString()
        } else {
            pending.result = response.result
        }
        pending.latch.countDown()
    }

    // ========================================================================
    // RPC
    // ========================================================================

    /**
     * Send an RPC request and wait for the response.
     */
    fun <T> call(method: String, params: Any? = null, resultClass: Class<T>): T? {
        val id = UUID.randomUUID().toString()
        val request = RpcRequest(id, method, params)
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
        eventListeners.getOrPut(event) { mutableListOf() }.add(listener)
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

    fun listSessions(): List<SessionInfo> {
        val result = call("sessions/list", null, ListSessionsResult::class.java)
        return result?.sessions ?: emptyList()
    }

    fun sendMessage(message: ChatMessage): String? {
        val result = call("chat/send", message, SendChatResult::class.java)
        return result?.runId
    }

    fun abortChat(sessionKey: String) {
        callRaw("chat/abort", mapOf("sessionKey" to sessionKey))
    }

    fun listAgents(): List<AgentInfo> {
        val result = call("agents/list", null, ListAgentsResult::class.java)
        return result?.agents ?: emptyList()
    }

    fun getHealth(): HealthResult? {
        return call("health", null, HealthResult::class.java)
    }
}
