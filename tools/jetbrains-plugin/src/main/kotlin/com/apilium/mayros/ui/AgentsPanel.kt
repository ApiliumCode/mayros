package com.apilium.mayros.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.apilium.mayros.MayrosClient
import com.apilium.mayros.MayrosService
import java.awt.BorderLayout
import javax.swing.*

/**
 * Agents tool window — displays available agents from the Mayros gateway.
 *
 * Shows a list of agents with their ID, name, and description.
 * Refresh button fetches the current list from the gateway.
 */
class AgentsPanel(@Suppress("unused") private val project: Project) : JPanel(BorderLayout()), MayrosService.ConnectionListener, Disposable {

    private val listModel = DefaultListModel<String>()
    private val agentList = JBList(listModel)
    private val refreshButton = JButton("Refresh")
    private val statusLabel = JLabel("Not connected")

    private val service = MayrosService.getInstance()

    init {
        setupUI()
        service.addListener(this)
    }

    private fun setupUI() {
        // Agent list
        val scrollPane = JBScrollPane(agentList)
        add(scrollPane, BorderLayout.CENTER)

        // Top bar
        val topPanel = JPanel(BorderLayout()).apply {
            add(statusLabel, BorderLayout.CENTER)
            add(refreshButton, BorderLayout.EAST)
        }
        add(topPanel, BorderLayout.NORTH)

        refreshButton.addActionListener { refreshAgents() }
    }

    private fun refreshAgents() {
        val client = service.getClient()
        if (client == null || !client.isConnected) {
            statusLabel.text = "Not connected"
            return
        }

        statusLabel.text = "Loading..."
        Thread {
            try {
                val agents = client.listAgents()
                SwingUtilities.invokeLater {
                    listModel.clear()
                    for (agent in agents) {
                        val label = if (agent.name != null) "${agent.id} — ${agent.name}" else agent.id
                        listModel.addElement(label)
                    }
                    statusLabel.text = "${agents.size} agent(s)"
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    statusLabel.text = "Error: ${e.message}"
                }
            }
        }.apply { isDaemon = true }.start()
    }

    override fun onConnected() {
        SwingUtilities.invokeLater {
            statusLabel.text = "Connected"
            refreshAgents()
        }
    }

    override fun onDisconnected(reason: String) {
        SwingUtilities.invokeLater {
            statusLabel.text = "Disconnected"
            listModel.clear()
        }
    }

    override fun dispose() {
        service.removeListener(this)
    }
}

class AgentsPanelFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = AgentsPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "", false)
        content.setDisposer(panel)
        toolWindow.contentManager.addContent(content)
    }
}
