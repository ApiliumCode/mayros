import MayrosKit
import Foundation
import Testing
import UIKit
@testable import Mayros

private func withUserDefaults<T>(_ updates: [String: Any?], _ body: () throws -> T) rethrows -> T {
    let defaults = UserDefaults.standard
    var snapshot: [String: Any?] = [:]
    for key in updates.keys {
        snapshot[key] = defaults.object(forKey: key)
    }
    for (key, value) in updates {
        if let value {
            defaults.set(value, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }
    defer {
        for (key, value) in snapshot {
            if let value {
                defaults.set(value, forKey: key)
            } else {
                defaults.removeObject(forKey: key)
            }
        }
    }
    return try body()
}

@MainActor
private final class MockWatchMessagingService: WatchMessagingServicing, @unchecked Sendable {
    var currentStatus = WatchMessagingStatus(
        supported: true,
        paired: true,
        appInstalled: true,
        reachable: true,
        activationState: "activated")
    var nextSendResult = WatchNotificationSendResult(
        deliveredImmediately: true,
        queuedForDelivery: false,
        transport: "sendMessage")
    var sendError: Error?
    var lastSent: (id: String, params: MayrosWatchNotifyParams)?
    private var replyHandler: (@Sendable (WatchQuickReplyEvent) -> Void)?

    func status() async -> WatchMessagingStatus {
        self.currentStatus
    }

    func setReplyHandler(_ handler: (@Sendable (WatchQuickReplyEvent) -> Void)?) {
        self.replyHandler = handler
    }

    func sendNotification(id: String, params: MayrosWatchNotifyParams) async throws -> WatchNotificationSendResult {
        self.lastSent = (id: id, params: params)
        if let sendError = self.sendError {
            throw sendError
        }
        return self.nextSendResult
    }

    func emitReply(_ event: WatchQuickReplyEvent) {
        self.replyHandler?(event)
    }
}

@Suite(.serialized) struct NodeAppModelInvokeTests {
    @Test @MainActor func decodeParamsFailsWithoutJSON() {
        #expect(throws: Error.self) {
            _ = try NodeAppModel._test_decodeParams(MayrosCanvasNavigateParams.self, from: nil)
        }
    }

    @Test @MainActor func encodePayloadEmitsJSON() throws {
        struct Payload: Codable, Equatable {
            var value: String
        }
        let json = try NodeAppModel._test_encodePayload(Payload(value: "ok"))
        #expect(json.contains("\"value\""))
    }

    @Test @MainActor func chatSessionKeyDefaultsToIOSBase() {
        let appModel = NodeAppModel()
        #expect(appModel.chatSessionKey == "ios")
    }

    @Test @MainActor func chatSessionKeyUsesAgentScopedKeyForNonDefaultAgent() {
        let appModel = NodeAppModel()
        appModel.gatewayDefaultAgentId = "main"
        appModel.setSelectedAgentId("agent-123")
        #expect(appModel.chatSessionKey == SessionKey.makeAgentSessionKey(agentId: "agent-123", baseKey: "ios"))
        #expect(appModel.mainSessionKey == "agent:agent-123:main")
    }

    @Test @MainActor func handleInvokeRejectsBackgroundCommands() async {
        let appModel = NodeAppModel()
        appModel.setScenePhase(.background)

        let req = BridgeInvokeRequest(id: "bg", command: MayrosCanvasCommand.present.rawValue)
        let res = await appModel._test_handleInvoke(req)
        #expect(res.ok == false)
        #expect(res.error?.code == .backgroundUnavailable)
    }

    @Test @MainActor func handleInvokeRejectsCameraWhenDisabled() async {
        let appModel = NodeAppModel()
        let req = BridgeInvokeRequest(id: "cam", command: MayrosCameraCommand.snap.rawValue)

        let defaults = UserDefaults.standard
        let key = "camera.enabled"
        let previous = defaults.object(forKey: key)
        defaults.set(false, forKey: key)
        defer {
            if let previous {
                defaults.set(previous, forKey: key)
            } else {
                defaults.removeObject(forKey: key)
            }
        }

        let res = await appModel._test_handleInvoke(req)
        #expect(res.ok == false)
        #expect(res.error?.code == .unavailable)
        #expect(res.error?.message.contains("CAMERA_DISABLED") == true)
    }

    @Test @MainActor func handleInvokeRejectsInvalidScreenFormat() async {
        let appModel = NodeAppModel()
        let params = MayrosScreenRecordParams(format: "gif")
        let data = try? JSONEncoder().encode(params)
        let json = data.flatMap { String(data: $0, encoding: .utf8) }

        let req = BridgeInvokeRequest(
            id: "screen",
            command: MayrosScreenCommand.record.rawValue,
            paramsJSON: json)

        let res = await appModel._test_handleInvoke(req)
        #expect(res.ok == false)
        #expect(res.error?.message.contains("screen format must be mp4") == true)
    }

    @Test @MainActor func handleInvokeCanvasCommandsUpdateScreen() async throws {
        let appModel = NodeAppModel()
        appModel.screen.navigate(to: "http://example.com")

        let present = BridgeInvokeRequest(id: "present", command: MayrosCanvasCommand.present.rawValue)
        let presentRes = await appModel._test_handleInvoke(present)
        #expect(presentRes.ok == true)
        #expect(appModel.screen.urlString.isEmpty)

        // Loopback URLs are rejected (they are not meaningful for a remote gateway).
        let navigateParams = MayrosCanvasNavigateParams(url: "http://example.com/")
        let navData = try JSONEncoder().encode(navigateParams)
        let navJSON = String(decoding: navData, as: UTF8.self)
        let navigate = BridgeInvokeRequest(
            id: "nav",
            command: MayrosCanvasCommand.navigate.rawValue,
            paramsJSON: navJSON)
        let navRes = await appModel._test_handleInvoke(navigate)
        #expect(navRes.ok == true)
        #expect(appModel.screen.urlString == "http://example.com/")

        let evalParams = MayrosCanvasEvalParams(javaScript: "1+1")
        let evalData = try JSONEncoder().encode(evalParams)
        let evalJSON = String(decoding: evalData, as: UTF8.self)
        let eval = BridgeInvokeRequest(
            id: "eval",
            command: MayrosCanvasCommand.evalJS.rawValue,
            paramsJSON: evalJSON)
        let evalRes = await appModel._test_handleInvoke(eval)
        #expect(evalRes.ok == true)
        let payloadData = try #require(evalRes.payloadJSON?.data(using: .utf8))
        let payload = try JSONSerialization.jsonObject(with: payloadData) as? [String: Any]
        #expect(payload?["result"] as? String == "2")
    }

    @Test @MainActor func handleInvokeA2UICommandsFailWhenHostMissing() async throws {
        let appModel = NodeAppModel()

        let reset = BridgeInvokeRequest(id: "reset", command: MayrosCanvasA2UICommand.reset.rawValue)
        let resetRes = await appModel._test_handleInvoke(reset)
        #expect(resetRes.ok == false)
        #expect(resetRes.error?.message.contains("A2UI_HOST_NOT_CONFIGURED") == true)

        let jsonl = "{\"beginRendering\":{}}"
        let pushParams = MayrosCanvasA2UIPushJSONLParams(jsonl: jsonl)
        let pushData = try JSONEncoder().encode(pushParams)
        let pushJSON = String(decoding: pushData, as: UTF8.self)
        let push = BridgeInvokeRequest(
            id: "push",
            command: MayrosCanvasA2UICommand.pushJSONL.rawValue,
            paramsJSON: pushJSON)
        let pushRes = await appModel._test_handleInvoke(push)
        #expect(pushRes.ok == false)
        #expect(pushRes.error?.message.contains("A2UI_HOST_NOT_CONFIGURED") == true)
    }

    @Test @MainActor func handleInvokeUnknownCommandReturnsInvalidRequest() async {
        let appModel = NodeAppModel()
        let req = BridgeInvokeRequest(id: "unknown", command: "nope")
        let res = await appModel._test_handleInvoke(req)
        #expect(res.ok == false)
        #expect(res.error?.code == .invalidRequest)
    }

    @Test @MainActor func handleInvokeWatchStatusReturnsServiceSnapshot() async throws {
        let watchService = MockWatchMessagingService()
        watchService.currentStatus = WatchMessagingStatus(
            supported: true,
            paired: true,
            appInstalled: true,
            reachable: false,
            activationState: "inactive")
        let appModel = NodeAppModel(watchMessagingService: watchService)
        let req = BridgeInvokeRequest(id: "watch-status", command: MayrosWatchCommand.status.rawValue)

        let res = await appModel._test_handleInvoke(req)
        #expect(res.ok == true)

        let payloadData = try #require(res.payloadJSON?.data(using: .utf8))
        let payload = try JSONDecoder().decode(MayrosWatchStatusPayload.self, from: payloadData)
        #expect(payload.supported == true)
        #expect(payload.reachable == false)
        #expect(payload.activationState == "inactive")
    }

    @Test @MainActor func handleInvokeWatchNotifyRoutesToWatchService() async throws {
        let watchService = MockWatchMessagingService()
        watchService.nextSendResult = WatchNotificationSendResult(
            deliveredImmediately: false,
            queuedForDelivery: true,
            transport: "transferUserInfo")
        let appModel = NodeAppModel(watchMessagingService: watchService)
        let params = MayrosWatchNotifyParams(
            title: "Mayros",
            body: "Meeting with Peter is at 4pm",
            priority: .timeSensitive)
        let paramsData = try JSONEncoder().encode(params)
        let paramsJSON = String(decoding: paramsData, as: UTF8.self)
        let req = BridgeInvokeRequest(
            id: "watch-notify",
            command: MayrosWatchCommand.notify.rawValue,
            paramsJSON: paramsJSON)

        let res = await appModel._test_handleInvoke(req)
        #expect(res.ok == true)
        #expect(watchService.lastSent?.params.title == "Mayros")
        #expect(watchService.lastSent?.params.body == "Meeting with Peter is at 4pm")
        #expect(watchService.lastSent?.params.priority == .timeSensitive)

        let payloadData = try #require(res.payloadJSON?.data(using: .utf8))
        let payload = try JSONDecoder().decode(MayrosWatchNotifyPayload.self, from: payloadData)
        #expect(payload.deliveredImmediately == false)
        #expect(payload.queuedForDelivery == true)
        #expect(payload.transport == "transferUserInfo")
    }

    @Test @MainActor func handleInvokeWatchNotifyRejectsEmptyMessage() async throws {
        let watchService = MockWatchMessagingService()
        let appModel = NodeAppModel(watchMessagingService: watchService)
        let params = MayrosWatchNotifyParams(title: "   ", body: "\n")
        let paramsData = try JSONEncoder().encode(params)
        let paramsJSON = String(decoding: paramsData, as: UTF8.self)
        let req = BridgeInvokeRequest(
            id: "watch-notify-empty",
            command: MayrosWatchCommand.notify.rawValue,
            paramsJSON: paramsJSON)

        let res = await appModel._test_handleInvoke(req)
        #expect(res.ok == false)
        #expect(res.error?.code == .invalidRequest)
        #expect(watchService.lastSent == nil)
    }

    @Test @MainActor func handleInvokeWatchNotifyReturnsUnavailableOnDeliveryFailure() async throws {
        let watchService = MockWatchMessagingService()
        watchService.sendError = NSError(
            domain: "watch",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "WATCH_UNAVAILABLE: no paired Apple Watch"])
        let appModel = NodeAppModel(watchMessagingService: watchService)
        let params = MayrosWatchNotifyParams(title: "Mayros", body: "Delivery check")
        let paramsData = try JSONEncoder().encode(params)
        let paramsJSON = String(decoding: paramsData, as: UTF8.self)
        let req = BridgeInvokeRequest(
            id: "watch-notify-fail",
            command: MayrosWatchCommand.notify.rawValue,
            paramsJSON: paramsJSON)

        let res = await appModel._test_handleInvoke(req)
        #expect(res.ok == false)
        #expect(res.error?.code == .unavailable)
        #expect(res.error?.message.contains("WATCH_UNAVAILABLE") == true)
    }

    @Test @MainActor func watchReplyQueuesWhenGatewayOffline() async {
        let watchService = MockWatchMessagingService()
        let appModel = NodeAppModel(watchMessagingService: watchService)
        watchService.emitReply(
            WatchQuickReplyEvent(
                replyId: "reply-offline-1",
                promptId: "prompt-1",
                actionId: "approve",
                actionLabel: "Approve",
                sessionKey: "ios",
                note: nil,
                sentAtMs: 1234,
                transport: "transferUserInfo"))
        #expect(appModel._test_queuedWatchReplyCount() == 1)
    }

    @Test @MainActor func handleDeepLinkSetsErrorWhenNotConnected() async {
        let appModel = NodeAppModel()
        let url = URL(string: "mayros://agent?message=hello")!
        await appModel.handleDeepLink(url: url)
        #expect(appModel.screen.errorText?.contains("Gateway not connected") == true)
    }

    @Test @MainActor func handleDeepLinkRejectsOversizedMessage() async {
        let appModel = NodeAppModel()
        let msg = String(repeating: "a", count: 20001)
        let url = URL(string: "mayros://agent?message=\(msg)")!
        await appModel.handleDeepLink(url: url)
        #expect(appModel.screen.errorText?.contains("Deep link too large") == true)
    }

    @Test @MainActor func sendVoiceTranscriptThrowsWhenGatewayOffline() async {
        let appModel = NodeAppModel()
        await #expect(throws: Error.self) {
            try await appModel.sendVoiceTranscript(text: "hello", sessionKey: "main")
        }
    }

    @Test @MainActor func canvasA2UIActionDispatchesStatus() async {
        let appModel = NodeAppModel()
        let body: [String: Any] = [
            "userAction": [
                "name": "tap",
                "id": "action-1",
                "surfaceId": "main",
                "sourceComponentId": "button-1",
                "context": ["value": "ok"],
            ],
        ]
        await appModel._test_handleCanvasA2UIAction(body: body)
        #expect(appModel.screen.urlString.isEmpty)
    }
}
