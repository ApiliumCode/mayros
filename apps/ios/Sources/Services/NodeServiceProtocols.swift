import CoreLocation
import Foundation
import MayrosKit
import UIKit

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: MayrosCameraSnapParams) async throws -> (format: String, base64: String, width: Int, height: Int)
    func clip(params: MayrosCameraClipParams) async throws -> (format: String, base64: String, durationMs: Int, hasAudio: Bool)
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func ensureAuthorization(mode: MayrosLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: MayrosLocationGetParams,
        desiredAccuracy: MayrosLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func startLocationUpdates(
        desiredAccuracy: MayrosLocationAccuracy,
        significantChangesOnly: Bool) -> AsyncStream<CLLocation>
    func stopLocationUpdates()
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

protocol DeviceStatusServicing: Sendable {
    func status() async throws -> MayrosDeviceStatusPayload
    func info() -> MayrosDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: MayrosPhotosLatestParams) async throws -> MayrosPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: MayrosContactsSearchParams) async throws -> MayrosContactsSearchPayload
    func add(params: MayrosContactsAddParams) async throws -> MayrosContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: MayrosCalendarEventsParams) async throws -> MayrosCalendarEventsPayload
    func add(params: MayrosCalendarAddParams) async throws -> MayrosCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: MayrosRemindersListParams) async throws -> MayrosRemindersListPayload
    func add(params: MayrosRemindersAddParams) async throws -> MayrosRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: MayrosMotionActivityParams) async throws -> MayrosMotionActivityPayload
    func pedometer(params: MayrosPedometerParams) async throws -> MayrosPedometerPayload
}

struct WatchMessagingStatus: Sendable, Equatable {
    var supported: Bool
    var paired: Bool
    var appInstalled: Bool
    var reachable: Bool
    var activationState: String
}

struct WatchQuickReplyEvent: Sendable, Equatable {
    var replyId: String
    var promptId: String
    var actionId: String
    var actionLabel: String?
    var sessionKey: String?
    var note: String?
    var sentAtMs: Int?
    var transport: String
}

struct WatchNotificationSendResult: Sendable, Equatable {
    var deliveredImmediately: Bool
    var queuedForDelivery: Bool
    var transport: String
}

protocol WatchMessagingServicing: AnyObject, Sendable {
    func status() async -> WatchMessagingStatus
    func setReplyHandler(_ handler: (@Sendable (WatchQuickReplyEvent) -> Void)?)
    func sendNotification(
        id: String,
        params: MayrosWatchNotifyParams) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
