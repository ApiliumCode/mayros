package com.apilium.mayros.ui

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.apilium.mayros.MayrosService
import com.apilium.mayros.settings.MayrosSettings
import java.awt.*
import java.io.File
import javax.swing.*

/**
 * Unified Mayros tool window — single entry point with tabbed panels.
 *
 * When disconnected: shows a setup/welcome screen with connection config.
 * When connected: shows a tabbed pane with Chat, Agents, Skills, Plan, Traces, KG.
 */
class MayrosMainPanel(private val project: Project) : JPanel(BorderLayout()), MayrosService.ConnectionListener, Disposable {

    private val cardLayout = CardLayout()
    private val cardContainer = JPanel(cardLayout)
    private val tabbedPane = JTabbedPane(JTabbedPane.TOP)
    private val service = MayrosService.getInstance()

    // Setup view components
    private val urlField = JTextField(30)
    private val tokenField = JPasswordField(30)
    private val connectButton = JButton("Connect")
    private val setupStatus = JLabel(" ")

    // Tab panels (lazy — created once on first connect)
    private var chatPanel: ChatPanel? = null
    private var agentsPanel: AgentsPanel? = null
    private var skillsPanel: SkillsPanel? = null
    private var planPanel: PlanPanel? = null
    private var tracesPanel: TracesPanel? = null
    private var kgPanel: KgPanel? = null

    companion object {
        private const val CARD_SETUP = "setup"
        private const val CARD_TABS = "tabs"
    }

    init {
        buildSetupView()
        buildTabbedView()

        cardContainer.add(createSetupWrapper(), CARD_SETUP)
        cardContainer.add(tabbedPane, CARD_TABS)
        add(cardContainer, BorderLayout.CENTER)

        service.addListener(this)

        // Always show setup first — user clicks Connect
        if (service.isConnected) {
            ensureTabsCreated()
            cardLayout.show(cardContainer, CARD_TABS)
        } else {
            cardLayout.show(cardContainer, CARD_SETUP)
        }
    }

    // ========================================================================
    // Setup view
    // ========================================================================

    private fun buildSetupView() {
        val settings = MayrosSettings.getInstance()
        urlField.text = settings.gatewayUrl

        // Auto-detect token: settings first, then ~/.mayros/mayros.json
        val token = MayrosSettings.getGatewayToken().takeIf { it.isNotBlank() } ?: detectGatewayToken()
        tokenField.text = token ?: ""

        connectButton.addActionListener { tryConnect() }

        // Allow Enter in fields to trigger connect
        urlField.addActionListener { tryConnect() }
        tokenField.addActionListener { tryConnect() }
    }

    /**
     * Read the gateway auth token from ~/.mayros/mayros.json if available.
     */
    private fun detectGatewayToken(): String? {
        return try {
            val configFile = File(System.getProperty("user.home"), ".mayros/mayros.json")
            if (!configFile.exists()) return null
            val root = Gson().fromJson(configFile.readText(), JsonObject::class.java)
            root?.getAsJsonObject("gateway")
                ?.getAsJsonObject("auth")
                ?.get("token")?.asString
        } catch (_: Exception) {
            null
        }
    }

    private fun createSetupWrapper(): JPanel {
        val wrapper = JPanel(GridBagLayout())
        val gbc = GridBagConstraints().apply {
            gridx = 0
            fill = GridBagConstraints.HORIZONTAL
            insets = Insets(4, 24, 4, 24)
        }

        // Title
        gbc.gridy = 0
        gbc.insets = Insets(24, 24, 8, 24)
        val title = JLabel("Mayros").apply {
            font = font.deriveFont(Font.BOLD, 20f)
            horizontalAlignment = SwingConstants.CENTER
        }
        wrapper.add(title, gbc)

        // Subtitle
        gbc.gridy = 1
        gbc.insets = Insets(0, 24, 16, 24)
        val subtitle = JLabel("Connect to the Mayros gateway to get started.").apply {
            horizontalAlignment = SwingConstants.CENTER
            foreground = UIManager.getColor("Label.disabledForeground") ?: Color.GRAY
        }
        wrapper.add(subtitle, gbc)

        // Gateway URL
        gbc.gridy = 2
        gbc.insets = Insets(8, 24, 2, 24)
        wrapper.add(JLabel("Gateway URL"), gbc)

        gbc.gridy = 3
        gbc.insets = Insets(0, 24, 8, 24)
        wrapper.add(urlField, gbc)

        // Token (optional)
        gbc.gridy = 4
        gbc.insets = Insets(8, 24, 2, 24)
        wrapper.add(JLabel("Token (optional)"), gbc)

        gbc.gridy = 5
        gbc.insets = Insets(0, 24, 12, 24)
        wrapper.add(tokenField, gbc)

        // Connect button
        gbc.gridy = 6
        gbc.insets = Insets(8, 24, 4, 24)
        gbc.fill = GridBagConstraints.NONE
        gbc.anchor = GridBagConstraints.CENTER
        wrapper.add(connectButton, gbc)

        // Status
        gbc.gridy = 7
        gbc.insets = Insets(4, 24, 24, 24)
        setupStatus.horizontalAlignment = SwingConstants.CENTER
        wrapper.add(setupStatus, gbc)

        // Hint
        gbc.gridy = 8
        gbc.insets = Insets(8, 24, 24, 24)
        val hint = JLabel("<html><center>Start the gateway with <code>mayros</code> in your terminal,<br>then click Connect.</center></html>").apply {
            horizontalAlignment = SwingConstants.CENTER
            foreground = UIManager.getColor("Label.disabledForeground") ?: Color.GRAY
            font = font.deriveFont(font.size2D - 1f)
        }
        wrapper.add(hint, gbc)

        return wrapper
    }

    private fun tryConnect() {
        // Save settings from fields (including auto-detected token)
        val settings = MayrosSettings.getInstance()
        settings.gatewayUrl = urlField.text.trim()
        MayrosSettings.setGatewayToken(String(tokenField.password))

        connectButton.isEnabled = false
        setupStatus.text = "Connecting..."
        setupStatus.foreground = UIManager.getColor("Label.foreground")

        Thread {
            try {
                val connected = service.connect()
                SwingUtilities.invokeLater {
                    connectButton.isEnabled = true
                    if (!connected) {
                        setupStatus.text = "Connection failed — is the gateway running?"
                        setupStatus.foreground = Color(0xE53935)
                    }
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    connectButton.isEnabled = true
                    setupStatus.text = "Error: ${e.message}"
                    setupStatus.foreground = Color(0xE53935)
                }
            }
        }.apply { isDaemon = true }.start()
    }

    // ========================================================================
    // Tabbed view
    // ========================================================================

    private fun buildTabbedView() {
        // Tabs are added lazily on first connect
    }

    private fun ensureTabsCreated() {
        if (chatPanel != null) return

        chatPanel = ChatPanel(project)
        agentsPanel = AgentsPanel(project)
        skillsPanel = SkillsPanel(project)
        planPanel = PlanPanel(project)
        tracesPanel = TracesPanel(project)
        kgPanel = KgPanel(project)

        tabbedPane.addTab("Chat", chatPanel)
        tabbedPane.addTab("Agents", agentsPanel)
        tabbedPane.addTab("Skills", skillsPanel)
        tabbedPane.addTab("Plan", planPanel)
        tabbedPane.addTab("Traces", tracesPanel)
        tabbedPane.addTab("KG", kgPanel)

        // Panels were created after onConnected fired, so notify them now
        chatPanel?.onConnected()
        agentsPanel?.onConnected()
        skillsPanel?.onConnected()
        planPanel?.onConnected()
        tracesPanel?.onConnected()
        kgPanel?.onConnected()
    }

    // ========================================================================
    // Connection listener
    // ========================================================================

    override fun onConnected() {
        SwingUtilities.invokeLater {
            ensureTabsCreated()
            cardLayout.show(cardContainer, CARD_TABS)
        }
    }

    override fun onDisconnected(reason: String) {
        SwingUtilities.invokeLater {
            setupStatus.text = "Disconnected: $reason"
            setupStatus.foreground = Color(0xE53935)
            cardLayout.show(cardContainer, CARD_SETUP)
        }
    }

    override fun dispose() {
        service.removeListener(this)
        (chatPanel as? Disposable)?.dispose()
        (tracesPanel as? Disposable)?.dispose()
        (planPanel as? Disposable)?.dispose()
        (agentsPanel as? Disposable)?.dispose()
        (skillsPanel as? Disposable)?.dispose()
        (kgPanel as? Disposable)?.dispose()
    }
}

class MayrosMainPanelFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = MayrosMainPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "", false).apply {
            setDisposer(panel)
        }
        toolWindow.contentManager.addContent(content)
    }
}
