import Foundation

public enum MayrosRemindersCommand: String, Codable, Sendable {
    case list = "reminders.list"
    case add = "reminders.add"
}

public enum MayrosReminderStatusFilter: String, Codable, Sendable {
    case incomplete
    case completed
    case all
}

public struct MayrosRemindersListParams: Codable, Sendable, Equatable {
    public var status: MayrosReminderStatusFilter?
    public var limit: Int?

    public init(status: MayrosReminderStatusFilter? = nil, limit: Int? = nil) {
        self.status = status
        self.limit = limit
    }
}

public struct MayrosRemindersAddParams: Codable, Sendable, Equatable {
    public var title: String
    public var dueISO: String?
    public var notes: String?
    public var listId: String?
    public var listName: String?

    public init(
        title: String,
        dueISO: String? = nil,
        notes: String? = nil,
        listId: String? = nil,
        listName: String? = nil)
    {
        self.title = title
        self.dueISO = dueISO
        self.notes = notes
        self.listId = listId
        self.listName = listName
    }
}

public struct MayrosReminderPayload: Codable, Sendable, Equatable {
    public var identifier: String
    public var title: String
    public var dueISO: String?
    public var completed: Bool
    public var listName: String?

    public init(
        identifier: String,
        title: String,
        dueISO: String? = nil,
        completed: Bool,
        listName: String? = nil)
    {
        self.identifier = identifier
        self.title = title
        self.dueISO = dueISO
        self.completed = completed
        self.listName = listName
    }
}

public struct MayrosRemindersListPayload: Codable, Sendable, Equatable {
    public var reminders: [MayrosReminderPayload]

    public init(reminders: [MayrosReminderPayload]) {
        self.reminders = reminders
    }
}

public struct MayrosRemindersAddPayload: Codable, Sendable, Equatable {
    public var reminder: MayrosReminderPayload

    public init(reminder: MayrosReminderPayload) {
        self.reminder = reminder
    }
}
