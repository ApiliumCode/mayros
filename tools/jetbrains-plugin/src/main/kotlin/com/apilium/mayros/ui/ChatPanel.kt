package com.apilium.mayros.ui

import com.google.gson.JsonObject
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.apilium.mayros.MayrosClient
import com.apilium.mayros.MayrosService
import java.awt.BorderLayout
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import java.util.UUID
import javax.swing.*

/**
 * Chat tool window — interactive conversation panel connected to the Mayros gateway.
 *
 * Layout:
 *   - Message history (scrollable text area)
 *   - Input field with send button
 *   - Status bar showing connection state
 */
class ChatPanel(private val project: Project) : JPanel(BorderLayout()), MayrosService.ConnectionListener {

    private val chatArea = JTextArea().apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
    }
    private val inputField = JTextField()
    private val sendButton = JButton("Send")
    private val statusLabel = JLabel("Disconnected")
    private val service = MayrosService.getInstance()
    private var currentSessionKey = "jetbrains-${UUID.randomUUID().toString().take(8)}"

    // Track our own event listeners so we can remove only ours on reconnect
    private val registeredListeners = mutableListOf<Pair<String, (JsonObject) -> Unit>>()

    init {
        setupUI()
        setupEventListeners()
        service.addListener(this)

        // Auto-connect if enabled
        if (com.apilium.mayros.settings.MayrosSettings.getInstance().autoConnect) {
            SwingUtilities.invokeLater { service.connect() }
        }
    }

    private fun setupUI() {
        // Chat history
        val scrollPane = JBScrollPane(chatArea)
        add(scrollPane, BorderLayout.CENTER)

        // Input panel
        val inputPanel = JPanel(BorderLayout()).apply {
            add(inputField, BorderLayout.CENTER)
            add(sendButton, BorderLayout.EAST)
        }
        add(inputPanel, BorderLayout.SOUTH)

        // Status bar
        add(statusLabel, BorderLayout.NORTH)
    }

    private fun setupEventListeners() {
        sendButton.addActionListener { sendMessage() }

        inputField.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(e: KeyEvent) {
                if (e.keyCode == KeyEvent.VK_ENTER) {
                    sendMessage()
                }
            }
        })

        // Subscribe to gateway chat events
        service.getClient()?.let { subscribeToEvents(it) }
    }

    private fun clearRegisteredListeners() {
        // On reconnect the old client is already disposed (its eventListeners cleared),
        // so we only need to reset our tracking list before subscribing to the new client.
        registeredListeners.clear()
    }

    private fun subscribeToEvents(client: MayrosClient) {
        val deltaListener: (JsonObject) -> Unit = { payload ->
            val text = payload.get("text")?.asString
            if (text != null) {
                SwingUtilities.invokeLater {
                    chatArea.append(text)
                    chatArea.caretPosition = chatArea.document.length
                }
            }
        }

        val finalListener: (JsonObject) -> Unit = { _ ->
            SwingUtilities.invokeLater {
                chatArea.append("\n\n")
                chatArea.caretPosition = chatArea.document.length
                statusLabel.text = "Ready"
            }
        }

        val errorListener: (JsonObject) -> Unit = { payload ->
            val error = payload.get("error")?.asString ?: "Unknown error"
            SwingUtilities.invokeLater {
                chatArea.append("\n[Error: $error]\n\n")
                statusLabel.text = "Error"
            }
        }

        client.on("chat.delta", deltaListener)
        client.on("chat.final", finalListener)
        client.on("chat.error", errorListener)

        registeredListeners.add("chat.delta" to deltaListener)
        registeredListeners.add("chat.final" to finalListener)
        registeredListeners.add("chat.error" to errorListener)
    }

    private fun sendMessage() {
        val text = inputField.text.trim()
        if (text.isEmpty()) return

        inputField.text = ""
        chatArea.append("You: $text\n\n")
        chatArea.caretPosition = chatArea.document.length
        statusLabel.text = "Sending..."

        val client = service.getClient()
        if (client == null || !client.isConnected) {
            chatArea.append("[Not connected. Use Settings to configure the gateway URL.]\n\n")
            statusLabel.text = "Disconnected"
            return
        }

        Thread {
            try {
                val runId = client.sendMessage(
                    MayrosClient.ChatMessage(
                        sessionKey = currentSessionKey,
                        message = text,
                        runId = UUID.randomUUID().toString()
                    )
                )
                SwingUtilities.invokeLater { statusLabel.text = "Waiting..." }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    chatArea.append("[Send failed: ${e.message}]\n\n")
                    statusLabel.text = "Error"
                }
            }
        }.start()
    }

    override fun onConnected() {
        SwingUtilities.invokeLater {
            statusLabel.text = "Connected"
            service.getClient()?.let {
                clearRegisteredListeners()
                subscribeToEvents(it)
            }
        }
    }

    override fun onDisconnected(reason: String) {
        SwingUtilities.invokeLater {
            statusLabel.text = "Disconnected: $reason"
        }
    }
}

/**
 * Factory for creating the Chat tool window.
 */
class ChatPanelFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = ChatPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "", false)
        toolWindow.contentManager.addContent(content)
    }
}
