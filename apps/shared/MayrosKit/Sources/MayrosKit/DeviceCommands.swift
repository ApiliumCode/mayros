import Foundation

public enum MayrosDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum MayrosBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum MayrosThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum MayrosNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum MayrosNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct MayrosBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: MayrosBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: MayrosBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct MayrosThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: MayrosThermalState

    public init(state: MayrosThermalState) {
        self.state = state
    }
}

public struct MayrosStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct MayrosNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: MayrosNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [MayrosNetworkInterfaceType]

    public init(
        status: MayrosNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [MayrosNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct MayrosDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: MayrosBatteryStatusPayload
    public var thermal: MayrosThermalStatusPayload
    public var storage: MayrosStorageStatusPayload
    public var network: MayrosNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: MayrosBatteryStatusPayload,
        thermal: MayrosThermalStatusPayload,
        storage: MayrosStorageStatusPayload,
        network: MayrosNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct MayrosDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}
