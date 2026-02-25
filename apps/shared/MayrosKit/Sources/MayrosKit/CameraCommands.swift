import Foundation

public enum MayrosCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum MayrosCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum MayrosCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum MayrosCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct MayrosCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: MayrosCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: MayrosCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: MayrosCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: MayrosCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct MayrosCameraClipParams: Codable, Sendable, Equatable {
    public var facing: MayrosCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: MayrosCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: MayrosCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: MayrosCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
