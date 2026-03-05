package com.apilium.mayros

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

/**
 * Unit tests for MayrosClient.
 *
 * Tests cover the client's RPC protocol types (including gateway v3 format),
 * device identity, options defaults, and state management. WebSocket integration
 * tests require a running gateway and are in a separate integration test suite.
 */
class MayrosClientTest {

    @Test
    fun `client options have sensible defaults`() {
        val opts = MayrosClient.ClientOptions()
        assertEquals(5, opts.maxReconnectAttempts)
        assertEquals(3000, opts.reconnectDelayMs)
        assertEquals(30000, opts.requestTimeoutMs)
        assertNull(opts.token)
    }

    @Test
    fun `client options with token`() {
        val opts = MayrosClient.ClientOptions(token = "my-secret-token")
        assertEquals("my-secret-token", opts.token)
    }

    @Test
    fun `client starts disconnected`() {
        val client = MayrosClient("ws://127.0.0.1:99999")
        assertFalse(client.isConnected)
    }

    @Test
    fun `rpc request includes type req`() {
        val request = MayrosClient.RpcRequest(
            id = "test-123",
            method = "chat.send",
            params = mapOf("message" to "hello")
        )
        assertEquals("req", request.type)
        assertEquals("test-123", request.id)
        assertEquals("chat.send", request.method)
        assertNotNull(request.params)
    }

    @Test
    fun `rpc request default type is req`() {
        val request = MayrosClient.RpcRequest(
            id = "abc",
            method = "health"
        )
        assertEquals("req", request.type)
    }

    @Test
    fun `method names use dots not slashes`() {
        val methods = listOf("sessions.list", "chat.send", "chat.abort", "agents.list", "health")
        for (method in methods) {
            assertFalse(method.contains("/"), "Method should not contain '/': $method")
            // sessions.list, chat.send, etc.
        }
    }

    @Test
    fun `chat message with idempotency key`() {
        val msg = MayrosClient.ChatMessage(
            sessionKey = "s1",
            message = "Hello world",
            idempotencyKey = "jb-12345-abc"
        )
        assertEquals("s1", msg.sessionKey)
        assertEquals("Hello world", msg.message)
        assertEquals("jb-12345-abc", msg.idempotencyKey)
    }

    @Test
    fun `chat message with minimal fields`() {
        val msg = MayrosClient.ChatMessage(
            sessionKey = "s1",
            message = "test"
        )
        assertNull(msg.idempotencyKey)
    }

    @Test
    fun `device identity data class`() {
        val identity = MayrosClient.DeviceIdentity(
            deviceId = "abc123",
            publicKeyPem = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAtest\n-----END PUBLIC KEY-----",
            privateKeyPem = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEItest\n-----END PRIVATE KEY-----"
        )
        assertEquals("abc123", identity.deviceId)
        assertTrue(identity.publicKeyPem.contains("BEGIN PUBLIC KEY"))
        assertTrue(identity.privateKeyPem.contains("BEGIN PRIVATE KEY"))
    }

    @Test
    fun `buildDeviceAuthPayload without nonce uses v1`() {
        val client = MayrosClient("ws://127.0.0.1:99999")
        val payload = client.buildDeviceAuthPayload(
            deviceId = "device-1",
            clientId = "gateway-client",
            clientMode = "ui",
            role = "operator",
            scopes = listOf("operator.read", "operator.write"),
            signedAtMs = 1700000000000,
            token = "tok-abc",
            nonce = null
        )
        assertEquals("v1|device-1|gateway-client|ui|operator|operator.read,operator.write|1700000000000|tok-abc", payload)
        client.dispose()
    }

    @Test
    fun `buildDeviceAuthPayload with nonce uses v2`() {
        val client = MayrosClient("ws://127.0.0.1:99999")
        val payload = client.buildDeviceAuthPayload(
            deviceId = "device-1",
            clientId = "gateway-client",
            clientMode = "ui",
            role = "operator",
            scopes = listOf("operator.read", "operator.write"),
            signedAtMs = 1700000000000,
            token = null,
            nonce = "challenge-nonce-xyz"
        )
        assertEquals("v2|device-1|gateway-client|ui|operator|operator.read,operator.write|1700000000000||challenge-nonce-xyz", payload)
        client.dispose()
    }

    @Test
    fun `buildDeviceAuthPayload with token and nonce`() {
        val client = MayrosClient("ws://127.0.0.1:99999")
        val payload = client.buildDeviceAuthPayload(
            deviceId = "dev-2",
            clientId = "gateway-client",
            clientMode = "ui",
            role = "operator",
            scopes = listOf("operator.read"),
            signedAtMs = 1700000000000,
            token = "my-token",
            nonce = "nonce-123"
        )
        assertEquals("v2|dev-2|gateway-client|ui|operator|operator.read|1700000000000|my-token|nonce-123", payload)
        client.dispose()
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

    @Test
    fun `chat history result data class`() {
        val result = MayrosClient.ChatHistoryResult(messages = emptyList())
        assertTrue(result.messages.isEmpty())
    }

    @Test
    fun `rpc response data class with ok payload`() {
        val response = MayrosClient.RpcResponse(
            type = "res",
            id = "123",
            ok = true
        )
        assertEquals("res", response.type)
        assertEquals(true, response.ok)
        assertNull(response.error)
    }

    @Test
    fun `skill info data class`() {
        val skill = MayrosClient.SkillInfo(
            name = "verify-kyc",
            status = "active",
            queryCount = 42,
            lastUsedAt = "2025-01-01T00:00:00Z"
        )
        assertEquals("verify-kyc", skill.name)
        assertEquals("active", skill.status)
        assertEquals(42, skill.queryCount)
        assertEquals("2025-01-01T00:00:00Z", skill.lastUsedAt)
    }

    @Test
    fun `skill info with null lastUsedAt`() {
        val skill = MayrosClient.SkillInfo(
            name = "code-review",
            status = "inactive",
            queryCount = 0
        )
        assertNull(skill.lastUsedAt)
    }

    @Test
    fun `skills result data class`() {
        val result = MayrosClient.SkillsResult(
            skills = listOf(
                MayrosClient.SkillInfo(name = "a", status = "active", queryCount = 1),
                MayrosClient.SkillInfo(name = "b", status = "inactive", queryCount = 0)
            )
        )
        assertEquals(2, result.skills.size)
    }

    @Test
    fun `plan info data class`() {
        val plan = MayrosClient.PlanInfo(
            id = "plan-1",
            phase = "explore",
            discoveries = emptyList(),
            assertions = emptyList(),
            createdAt = "2025-01-01T00:00:00Z"
        )
        assertEquals("plan-1", plan.id)
        assertEquals("explore", plan.phase)
        assertTrue(plan.discoveries.isEmpty())
        assertTrue(plan.assertions.isEmpty())
    }

    @Test
    fun `trace event data class`() {
        val event = MayrosClient.TraceEvent(
            id = "ev-1",
            type = "tool_call",
            agentId = "agent-1",
            timestamp = "2025-01-01T00:00:00Z"
        )
        assertEquals("ev-1", event.id)
        assertEquals("tool_call", event.type)
        assertEquals("agent-1", event.agentId)
        assertNull(event.data)
        assertNull(event.parentId)
    }

    @Test
    fun `trace events result data class`() {
        val result = MayrosClient.TraceEventsResult(events = emptyList())
        assertTrue(result.events.isEmpty())
    }

    @Test
    fun `kg entry data class`() {
        val entry = MayrosClient.KgEntry(
            subject = "ns:myProject",
            predicate = "uses",
            objectValue = "ns:typescript",
            id = "triple-1"
        )
        assertEquals("ns:myProject", entry.subject)
        assertEquals("uses", entry.predicate)
        assertEquals("ns:typescript", entry.objectValue)
        assertEquals("triple-1", entry.id)
    }

    @Test
    fun `kg result data class`() {
        val result = MayrosClient.KgResult(
            entries = listOf(
                MayrosClient.KgEntry(subject = "a", predicate = "b", objectValue = "c", id = "1")
            )
        )
        assertEquals(1, result.entries.size)
    }

    @Test
    fun `kg result empty`() {
        val result = MayrosClient.KgResult(entries = emptyList())
        assertTrue(result.entries.isEmpty())
    }

    @Test
    fun `new method names use dots`() {
        val methods = listOf("skills.status", "plan.get", "trace.events", "kg.query")
        for (method in methods) {
            assertFalse(method.contains("/"), "Method should not contain '/': $method")
            assertTrue(method.contains("."), "Method should use dot separator: $method")
        }
    }
}
