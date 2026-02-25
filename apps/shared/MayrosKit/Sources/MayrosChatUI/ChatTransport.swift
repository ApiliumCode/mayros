import Foundation

public enum MayrosChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(MayrosChatEventPayload)
    case agent(MayrosAgentEventPayload)
    case seqGap
}

public protocol MayrosChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> MayrosChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [MayrosChatAttachmentPayload]) async throws -> MayrosChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> MayrosChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<MayrosChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension MayrosChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "MayrosChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> MayrosChatSessionsListResponse {
        throw NSError(
            domain: "MayrosChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
