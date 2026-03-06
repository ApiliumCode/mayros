package com.apilium.mayros.ui

import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.apilium.mayros.MayrosService
import com.intellij.openapi.diagnostic.Logger
import java.awt.BorderLayout
import java.awt.FlowLayout
import java.awt.Font
import javax.swing.*
import javax.swing.table.DefaultTableModel

/**
 * Plan tool window — displays the current plan for a session.
 *
 * Top bar: session selector (combo box) + Refresh button.
 * Body: phase label, discoveries table, assertions table.
 */
class PlanPanel(@Suppress("unused") private val project: Project) : JPanel(BorderLayout()), MayrosService.ConnectionListener, Disposable {

    private val sessionCombo = JComboBox<String>()
    private val refreshButton = JButton("Refresh")
    private val phaseLabel = JLabel("Phase: —")
    private val discoveriesModel = DefaultTableModel(arrayOf("Text", "Source"), 0)
    private val discoveriesTable = JTable(discoveriesModel)
    private val assertionsModel = DefaultTableModel(arrayOf("Subject", "Predicate", "Verified"), 0)
    private val assertionsTable = JTable(assertionsModel)
    private val service = MayrosService.getInstance()
    private val registeredListeners = mutableListOf<Pair<String, (JsonObject) -> Unit>>()
    private val logger = Logger.getInstance(PlanPanel::class.java)

    init {
        setupUI()
        service.addListener(this)
    }

    private fun setupUI() {
        // Top bar
        val topPanel = JPanel(FlowLayout(FlowLayout.LEFT)).apply {
            add(JLabel("Session:"))
            add(sessionCombo)
            add(refreshButton)
        }
        add(topPanel, BorderLayout.NORTH)

        // Phase label
        phaseLabel.font = phaseLabel.font.deriveFont(Font.BOLD)

        // Body: phase + discoveries + assertions
        val body = Box.createVerticalBox().apply {
            add(phaseLabel)
            add(Box.createVerticalStrut(8))
            add(JLabel("Discoveries"))
            add(JBScrollPane(discoveriesTable).apply { preferredSize = java.awt.Dimension(400, 150) })
            add(Box.createVerticalStrut(8))
            add(JLabel("Assertions"))
            add(JBScrollPane(assertionsTable).apply { preferredSize = java.awt.Dimension(400, 150) })
        }
        add(JBScrollPane(body), BorderLayout.CENTER)

        refreshButton.addActionListener { refreshPlan() }
    }

    private fun refreshPlan() {
        val client = service.getClient()
        if (client == null || !client.isConnected) return

        val sessionId = sessionCombo.selectedItem as? String ?: return

        Thread {
            try {
                val plan = client.getPlan(sessionId)
                SwingUtilities.invokeLater { updatePlanUI(plan) }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    phaseLabel.text = "Phase: error — ${e.message}"
                }
            }
        }.apply { isDaemon = true }.start()
    }

    private fun updatePlanUI(plan: JsonObject?) {
        discoveriesModel.rowCount = 0
        assertionsModel.rowCount = 0

        if (plan == null) {
            phaseLabel.text = "Phase: no plan"
            return
        }

        val phase = plan.get("phase")?.asString ?: "unknown"
        phaseLabel.text = "Phase: $phase"

        plan.getAsJsonArray("discoveries")?.forEach { d ->
            val obj = d.asJsonObject
            discoveriesModel.addRow(arrayOf(
                obj.get("text")?.asString ?: "",
                obj.get("source")?.asString ?: ""
            ))
        }

        plan.getAsJsonArray("assertions")?.forEach { a ->
            val obj = a.asJsonObject
            assertionsModel.addRow(arrayOf(
                obj.get("subject")?.asString ?: "",
                obj.get("predicate")?.asString ?: "",
                obj.get("verified")?.asBoolean?.toString() ?: "false"
            ))
        }
    }

    private fun clearRegisteredListeners() {
        val client = service.getClient()
        if (client != null) {
            for ((event, listener) in registeredListeners) {
                client.off(event, listener)
            }
        }
        registeredListeners.clear()
    }

    private fun subscribeToEvents() {
        val client = service.getClient() ?: return
        val listener: (JsonObject) -> Unit = { _ ->
            SwingUtilities.invokeLater { refreshPlan() }
        }
        client.on("plan.updated", listener)
        registeredListeners.add("plan.updated" to listener)
    }

    private fun refreshSessions() {
        val client = service.getClient() ?: return
        Thread {
            try {
                val sessions = client.listSessions()
                SwingUtilities.invokeLater {
                    sessionCombo.removeAllItems()
                    for (session in sessions) {
                        sessionCombo.addItem(session.key)
                    }
                }
            } catch (e: Exception) {
                logger.warn("Failed to refresh sessions", e)
            }
        }.apply { isDaemon = true }.start()
    }

    override fun onConnected() {
        SwingUtilities.invokeLater {
            clearRegisteredListeners()
            subscribeToEvents()
            refreshSessions()
        }
    }

    override fun onDisconnected(reason: String) {
        SwingUtilities.invokeLater {
            phaseLabel.text = "Phase: —"
            discoveriesModel.rowCount = 0
            assertionsModel.rowCount = 0
            sessionCombo.removeAllItems()
        }
    }

    override fun dispose() {
        service.removeListener(this)
        clearRegisteredListeners()
    }
}

class PlanPanelFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = PlanPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "", false).apply {
            setDisposer(panel)
        }
        toolWindow.contentManager.addContent(content)
    }
}
