package com.apilium.mayros

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach

/**
 * Unit tests for MayrosClient.
 *
 * Tests cover the client's RPC protocol types, options defaults,
 * and state management. WebSocket integration tests require a running
 * gateway and are in a separate integration test suite.
 */
class MayrosClientTest {

    @Test
    fun `client options have sensible defaults`() {
        val opts = MayrosClient.ClientOptions()
        assertEquals(5, opts.maxReconnectAttempts)
        assertEquals(3000, opts.reconnectDelayMs)
        assertEquals(30000, opts.requestTimeoutMs)
    }

    @Test
    fun `client starts disconnected`() {
        val client = MayrosClient("ws://127.0.0.1:99999")
        assertFalse(client.isConnected)
    }

    @Test
    fun `rpc request creates valid structure`() {
        val request = MayrosClient.RpcRequest(
            id = "test-123",
            method = "chat/send",
            params = mapOf("message" to "hello")
        )
        assertEquals("test-123", request.id)
        assertEquals("chat/send", request.method)
        assertNotNull(request.params)
    }

    @Test
    fun `chat message has required fields`() {
        val msg = MayrosClient.ChatMessage(
            sessionKey = "s1",
            message = "Hello world",
            thinking = "medium",
            runId = "run-1"
        )
        assertEquals("s1", msg.sessionKey)
        assertEquals("Hello world", msg.message)
        assertEquals("medium", msg.thinking)
        assertEquals("run-1", msg.runId)
    }

    @Test
    fun `chat message with minimal fields`() {
        val msg = MayrosClient.ChatMessage(
            sessionKey = "s1",
            message = "test"
        )
        assertNull(msg.thinking)
        assertNull(msg.runId)
    }

    @Test
    fun `session info data class`() {
        val info = MayrosClient.SessionInfo(
            key = "session-1",
            displayName = "My Session",
            model = "claude-3",
            updatedAt = 12345L
        )
        assertEquals("session-1", info.key)
        assertEquals("My Session", info.displayName)
    }

    @Test
    fun `agent info data class`() {
        val agent = MayrosClient.AgentInfo(
            id = "agent-1",
            name = "Code Review Agent",
            description = "Reviews code for quality"
        )
        assertEquals("agent-1", agent.id)
        assertEquals("Code Review Agent", agent.name)
    }

    @Test
    fun `health result data class`() {
        val health = MayrosClient.HealthResult(
            status = "ok",
            version = "0.5.0"
        )
        assertEquals("ok", health.status)
        assertEquals("0.5.0", health.version)
    }

    @Test
    fun `custom client options`() {
        val opts = MayrosClient.ClientOptions(
            maxReconnectAttempts = 10,
            reconnectDelayMs = 5000,
            requestTimeoutMs = 60000
        )
        assertEquals(10, opts.maxReconnectAttempts)
        assertEquals(5000, opts.reconnectDelayMs)
        assertEquals(60000, opts.requestTimeoutMs)
    }

    @Test
    fun `connect to unreachable server returns false`() {
        val client = MayrosClient(
            url = "ws://127.0.0.1:1",
            options = MayrosClient.ClientOptions(
                maxReconnectAttempts = 0,
                reconnectDelayMs = 100,
                requestTimeoutMs = 1000
            )
        )
        val connected = client.connect()
        assertFalse(connected)
        assertFalse(client.isConnected)
        client.dispose()
    }

    @Test
    fun `dispose clears state`() {
        val client = MayrosClient("ws://127.0.0.1:99999")
        client.dispose()
        assertFalse(client.isConnected)
    }

    @Test
    fun `disconnect when not connected is safe`() {
        val client = MayrosClient("ws://127.0.0.1:99999")
        assertDoesNotThrow { client.disconnect() }
    }

    @Test
    fun `list sessions result data class`() {
        val result = MayrosClient.ListSessionsResult(
            sessions = listOf(
                MayrosClient.SessionInfo(key = "s1"),
                MayrosClient.SessionInfo(key = "s2")
            )
        )
        assertEquals(2, result.sessions.size)
    }

    @Test
    fun `list agents result data class`() {
        val result = MayrosClient.ListAgentsResult(
            agents = listOf(
                MayrosClient.AgentInfo(id = "a1"),
                MayrosClient.AgentInfo(id = "a2", name = "Helper")
            )
        )
        assertEquals(2, result.agents.size)
        assertEquals("Helper", result.agents[1].name)
    }

    @Test
    fun `send chat result data class`() {
        val result = MayrosClient.SendChatResult(runId = "run-abc")
        assertEquals("run-abc", result.runId)
    }

    @Test
    fun `send chat result with null runId`() {
        val result = MayrosClient.SendChatResult(runId = null)
        assertNull(result.runId)
    }
}
