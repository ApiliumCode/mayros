package com.apilium.mayros.ui

import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.apilium.mayros.MayrosService
import java.awt.BorderLayout
import javax.swing.*

/**
 * Skills tool window — displays loaded skills and their status from the gateway.
 */
class SkillsPanel(@Suppress("unused") private val project: Project) : JPanel(BorderLayout()), MayrosService.ConnectionListener {

    private val listModel = DefaultListModel<String>()
    private val skillList = JBList(listModel)
    private val refreshButton = JButton("Refresh")
    private val statusLabel = JLabel("Not connected")

    init {
        setupUI()
        MayrosService.getInstance().addListener(this)
    }

    private fun setupUI() {
        val scrollPane = JBScrollPane(skillList)
        add(scrollPane, BorderLayout.CENTER)

        val topPanel = JPanel(BorderLayout()).apply {
            add(statusLabel, BorderLayout.CENTER)
            add(refreshButton, BorderLayout.EAST)
        }
        add(topPanel, BorderLayout.NORTH)

        refreshButton.addActionListener { refreshSkills() }
    }

    private fun refreshSkills() {
        val client = MayrosService.getInstance().getClient()
        if (client == null || !client.isConnected) {
            statusLabel.text = "Not connected"
            return
        }

        statusLabel.text = "Loading..."
        Thread {
            try {
                val skills = client.getSkillsStatus()
                SwingUtilities.invokeLater {
                    listModel.clear()
                    for (skill in skills) {
                        listModel.addElement("${skill.name} — ${skill.status} (${skill.queryCount} queries)")
                    }
                    statusLabel.text = "${skills.size} skill(s)"
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    statusLabel.text = "Error: ${e.message}"
                }
            }
        }.start()
    }

    override fun onConnected() {
        SwingUtilities.invokeLater {
            statusLabel.text = "Connected"
            refreshSkills()
        }
    }

    override fun onDisconnected(reason: String) {
        SwingUtilities.invokeLater {
            statusLabel.text = "Disconnected"
            listModel.clear()
        }
    }
}

class SkillsPanelFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = SkillsPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "", false)
        toolWindow.contentManager.addContent(content)
    }
}
