package com.apilium.mayros.ui

import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.intellij.util.ui.UIUtil
import com.apilium.mayros.MayrosClient
import com.apilium.mayros.MayrosService
import java.awt.BorderLayout
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import java.util.UUID
import javax.swing.*

/**
 * Chat panel — styled HTML conversation with message bubbles.
 * Uses table-based HTML layout compatible with Swing's JEditorPane (HTML 3.2).
 */
class ChatPanel(private val project: Project) : JPanel(BorderLayout()), MayrosService.ConnectionListener, Disposable {

    private val chatPane = JEditorPane().apply {
        contentType = "text/html"
        isEditable = false
    }
    private val scrollPane = JBScrollPane(chatPane)
    private val inputField = JTextField()
    private val sendButton = JButton("Send")
    private val statusLabel = JLabel("Disconnected")
    private val sessionCombo = JComboBox<SessionItem>()
    private val service = MayrosService.getInstance()
    private var currentSessionKey: String? = null

    private val registeredListeners = mutableListOf<Pair<String, (JsonObject) -> Unit>>()
    private val streamBuffer = StringBuilder()
    private val messages = mutableListOf<ChatBubble>()

    private data class SessionItem(val key: String, val displayName: String) {
        override fun toString(): String = displayName.ifBlank { key }
    }

    private data class ChatBubble(val role: String, val text: String)

    init {
        setupUI()
        setupEventListeners()
        service.addListener(this)
        renderMessages()
    }

    private fun setupUI() {
        val topPanel = JPanel(BorderLayout()).apply {
            add(JLabel(" Session: "), BorderLayout.WEST)
            add(sessionCombo, BorderLayout.CENTER)
            add(statusLabel, BorderLayout.EAST)
        }
        add(topPanel, BorderLayout.NORTH)
        add(scrollPane, BorderLayout.CENTER)

        val inputPanel = JPanel(BorderLayout()).apply {
            add(inputField, BorderLayout.CENTER)
            add(sendButton, BorderLayout.EAST)
        }
        add(inputPanel, BorderLayout.SOUTH)
    }

    private fun setupEventListeners() {
        sendButton.addActionListener { sendMessage() }
        inputField.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(e: KeyEvent) {
                if (e.keyCode == KeyEvent.VK_ENTER) sendMessage()
            }
        })
        sessionCombo.addActionListener {
            val selected = sessionCombo.selectedItem as? SessionItem ?: return@addActionListener
            if (selected.key != currentSessionKey) {
                currentSessionKey = selected.key
                loadChatHistory(selected.key)
            }
        }
        service.getClient()?.let { subscribeToEvents(it) }
    }

    private fun clearRegisteredListeners() {
        // Unregister listeners from the current client before clearing the tracking list.
        // Prevents duplicate event delivery and memory leaks on reconnect or dispose.
        val client = service.getClient()
        if (client != null) {
            for ((event, listener) in registeredListeners) {
                client.off(event, listener)
            }
        }
        registeredListeners.clear()
    }

    private fun subscribeToEvents(client: MayrosClient) {
        val chatListener: (JsonObject) -> Unit = { payload ->
            val state = payload.get("state")?.asString
            val message = payload.getAsJsonObject("message")

            when (state) {
                "delta" -> {
                    val text = extractTextFromMessage(message)
                    if (text.isNotEmpty()) {
                        streamBuffer.append(text)
                        SwingUtilities.invokeLater { renderWithStream() }
                    }
                }
                "final" -> {
                    SwingUtilities.invokeLater {
                        val finalText = cleanGatewayText(streamBuffer.toString().trim())
                        streamBuffer.clear()
                        if (finalText.isNotEmpty()) {
                            messages.add(ChatBubble("assistant", finalText))
                        }
                        renderMessages()
                        statusLabel.text = " Ready "
                    }
                }
                "error" -> {
                    val errorText = message?.get("error")?.asString
                        ?: extractTextFromMessage(message).ifEmpty { "Unknown error" }
                    SwingUtilities.invokeLater {
                        streamBuffer.clear()
                        messages.add(ChatBubble("error", errorText))
                        renderMessages()
                        statusLabel.text = " Error "
                    }
                }
            }
        }
        client.on("chat", chatListener)
        registeredListeners.add("chat" to chatListener)
    }

    private fun extractTextFromMessage(message: JsonObject?): String {
        if (message == null) return ""
        val content = message.getAsJsonArray("content")
        if (content != null) {
            return content
                .filter { it.isJsonObject }
                .map { it.asJsonObject }
                .filter { it.get("type")?.asString == "text" }
                .mapNotNull { it.get("text")?.asString }
                .joinToString("")
        }
        return message.get("text")?.asString ?: ""
    }

    /**
     * Strip gateway artifacts: <think>...</think>, <final>...</final>, stray tags.
     */
    private fun cleanGatewayText(raw: String): String {
        var text = raw
        // Remove <think>...</think> blocks (including multiline)
        text = text.replace(Regex("<think>[\\s\\S]*?</think>"), "")
        // Remove <final> and </final> wrappers
        text = text.replace(Regex("</?final>"), "")
        // Remove any remaining XML-like tags that aren't standard markdown
        text = text.replace(Regex("</?(?:result|response|answer|output)>"), "")
        return text.trim()
    }

    // ========================================================================
    // HTML rendering (Swing HTML 3.2 compatible — tables, not flexbox)
    // ========================================================================

    private fun renderMessages() {
        chatPane.text = buildHtml(messages, streamingText = null)
        scrollToBottom()
    }

    private fun renderWithStream() {
        chatPane.text = buildHtml(messages, streamingText = cleanGatewayText(streamBuffer.toString()))
        scrollToBottom()
    }

    private fun scrollToBottom() {
        SwingUtilities.invokeLater {
            val sb = scrollPane.verticalScrollBar
            sb.value = sb.maximum
        }
    }

    private fun buildHtml(msgs: List<ChatBubble>, streamingText: String?): String {
        val dark = UIUtil.isUnderDarcula()
        val bg = if (dark) "#2b2b2b" else "#f5f5f5"
        val userBg = if (dark) "#3b4a8c" else "#6366F1"
        val userFg = "#ffffff"
        val assistantBg = if (dark) "#3c3f41" else "#ffffff"
        val assistantFg = if (dark) "#d4d4d4" else "#1a1a1a"
        val assistantBorder = if (dark) "#555555" else "#d0d0d0"
        val errorBg = if (dark) "#4a2020" else "#fff0f0"
        val errorFg = if (dark) "#ff8a80" else "#c62828"
        val roleFg = if (dark) "#888888" else "#999999"
        val codeBg = if (dark) "#1e1e1e" else "#e8e8e8"
        val userCodeBg = if (dark) "#2d3a6e" else "#4f46e5"
        val bodyFont = "font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 13px;"

        val sb = StringBuilder()
        sb.append("<html><head></head><body bgcolor=\"$bg\" style=\"$bodyFont margin: 0; padding: 4px;\">")

        for (msg in msgs) {
            appendBubble(sb, msg, userBg, userFg, assistantBg, assistantFg, assistantBorder, errorBg, errorFg, roleFg, codeBg, userCodeBg)
        }

        if (!streamingText.isNullOrBlank()) {
            appendBubble(
                sb,
                ChatBubble("streaming", streamingText),
                userBg, userFg, assistantBg, assistantFg, assistantBorder, errorBg, errorFg, roleFg, codeBg, userCodeBg
            )
        }

        sb.append("</body></html>")
        return sb.toString()
    }

    private fun appendBubble(
        sb: StringBuilder,
        msg: ChatBubble,
        userBg: String, userFg: String,
        assistantBg: String, assistantFg: String, assistantBorder: String,
        errorBg: String, errorFg: String,
        roleFg: String, codeBg: String, userCodeBg: String,
    ) {
        val isUser = msg.role == "user"
        val isError = msg.role == "error"

        val bubbleBg = when {
            isUser -> userBg
            isError -> errorBg
            else -> assistantBg
        }
        val bubbleFg = when {
            isUser -> userFg
            isError -> errorFg
            else -> assistantFg
        }
        val bubbleCodeBg = if (isUser) userCodeBg else codeBg
        val roleLabel = when (msg.role) {
            "user" -> "You"
            "assistant", "streaming" -> "Mayros"
            "error" -> "Error"
            else -> msg.role.replaceFirstChar { it.uppercase() }
        }
        val align = if (isUser) "right" else "left"

        // Use a table for the bubble layout (JEditorPane compatible)
        sb.append("<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>")

        if (isUser) {
            // Right-align: empty left cell + bubble right
            sb.append("<td width=\"20%\">&nbsp;</td>")
            sb.append("<td width=\"80%\" align=\"right\">")
        } else {
            // Left-align: bubble left + empty right cell
            sb.append("<td width=\"80%\" align=\"left\">")
        }

        sb.append("<table cellpadding=\"10\" cellspacing=\"0\" border=\"0\" width=\"100%\">")
        sb.append("<tr><td bgcolor=\"$bubbleBg\" style=\"padding: 10px 14px;\">")

        // Role label
        sb.append("<font color=\"")
        sb.append(if (isUser) "#e0e0ff" else roleFg)
        sb.append("\" size=\"2\"><b>$roleLabel</b></font><br>")

        // Content
        sb.append("<font color=\"$bubbleFg\">")
        sb.append(markdownToHtml(msg.text, bubbleCodeBg, bubbleFg))
        sb.append("</font>")

        sb.append("</td></tr></table>")
        sb.append("</td>")

        if (!isUser) {
            sb.append("<td width=\"20%\">&nbsp;</td>")
        }

        sb.append("</tr></table>")
        sb.append("<br>") // spacing between messages
    }

    private fun markdownToHtml(text: String, codeBg: String, textFg: String): String {
        val escaped = text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")

        val lines = escaped.split("\n")
        val result = StringBuilder()
        var inCodeBlock = false

        for (line in lines) {
            if (line.trimStart().startsWith("```")) {
                if (inCodeBlock) {
                    result.append("</pre>")
                    inCodeBlock = false
                } else {
                    result.append("<pre style=\"background-color: $codeBg; padding: 6px;\">")
                    inCodeBlock = true
                }
                continue
            }
            if (inCodeBlock) {
                result.append(line).append("\n")
                continue
            }

            var processed = line

            // Headers
            when {
                processed.startsWith("### ") -> { result.append("<b>").append(processed.drop(4)).append("</b><br>"); continue }
                processed.startsWith("## ") -> { result.append("<b><font size=\"4\">").append(processed.drop(3)).append("</font></b><br>"); continue }
                processed.startsWith("# ") -> { result.append("<b><font size=\"5\">").append(processed.drop(2)).append("</font></b><br>"); continue }
            }

            // Inline code
            processed = processed.replace(Regex("`([^`]+)`"), "<code style=\"background-color: $codeBg; padding: 1px 3px;\">$1</code>")
            // Bold
            processed = processed.replace(Regex("\\*\\*([^*]+)\\*\\*"), "<b>$1</b>")
            // List items
            val trimmed = processed.trimStart()
            if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
                processed = "&nbsp;&nbsp;&bull; " + trimmed.removePrefix("* ").removePrefix("- ")
            }

            result.append(if (processed.isBlank()) "<br>" else "$processed<br>")
        }

        if (inCodeBlock) result.append("</pre>")
        return result.toString()
    }

    // ========================================================================
    // Data loading
    // ========================================================================

    private fun loadChatHistory(sessionKey: String) {
        messages.clear()
        renderMessages()
        statusLabel.text = " Loading... "

        Thread {
            try {
                val client = service.getClient() ?: return@Thread
                val historyMessages = client.getChatHistory(sessionKey)
                SwingUtilities.invokeLater {
                    for (msg in historyMessages) {
                        val role = msg.get("role")?.asString ?: "system"
                        val rawText = extractTextFromMessage(msg)
                        val text = cleanGatewayText(rawText)
                        if (text.isNotEmpty()) {
                            messages.add(ChatBubble(role, text))
                        }
                    }
                    renderMessages()
                    statusLabel.text = " Ready "
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    messages.add(ChatBubble("error", "Failed to load history: ${e.message}"))
                    renderMessages()
                    statusLabel.text = " Error "
                }
            }
        }.start()
    }

    private fun loadSessions() {
        Thread {
            try {
                val client = service.getClient() ?: return@Thread
                val sessions = client.listSessions()
                SwingUtilities.invokeLater {
                    sessionCombo.removeAllItems()
                    for (session in sessions) {
                        sessionCombo.addItem(SessionItem(
                            key = session.key,
                            displayName = session.displayName ?: session.key
                        ))
                    }
                    if (sessionCombo.itemCount > 0) {
                        sessionCombo.selectedIndex = 0
                    }
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    messages.add(ChatBubble("error", "Failed to load sessions: ${e.message}"))
                    renderMessages()
                }
            }
        }.start()
    }

    private fun sendMessage() {
        val text = inputField.text.trim()
        if (text.isEmpty()) return

        val sessionKey = currentSessionKey
        if (sessionKey == null) {
            messages.add(ChatBubble("error", "No session selected."))
            renderMessages()
            return
        }

        inputField.text = ""
        messages.add(ChatBubble("user", text))
        streamBuffer.clear()
        renderMessages()
        statusLabel.text = " Sending... "

        val client = service.getClient()
        if (client == null || !client.isConnected) {
            messages.add(ChatBubble("error", "Not connected to gateway."))
            renderMessages()
            statusLabel.text = " Disconnected "
            return
        }

        Thread {
            try {
                client.sendMessage(
                    MayrosClient.ChatMessage(
                        sessionKey = sessionKey,
                        message = text,
                        idempotencyKey = "jb-${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}"
                    )
                )
                SwingUtilities.invokeLater { statusLabel.text = " Waiting... " }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    messages.add(ChatBubble("error", "Send failed: ${e.message}"))
                    renderMessages()
                    statusLabel.text = " Error "
                }
            }
        }.start()
    }

    override fun onConnected() {
        SwingUtilities.invokeLater {
            statusLabel.text = " Connected "
            service.getClient()?.let {
                clearRegisteredListeners()
                subscribeToEvents(it)
            }
            loadSessions()
        }
    }

    override fun onDisconnected(reason: String) {
        SwingUtilities.invokeLater {
            statusLabel.text = " Disconnected: $reason "
        }
    }

    override fun dispose() {
        service.removeListener(this)
        clearRegisteredListeners()
    }
}

class ChatPanelFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = ChatPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "", false).apply {
            setDisposer(panel)
        }
        toolWindow.contentManager.addContent(content)
    }
}
