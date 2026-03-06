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
import java.awt.BorderLayout
import javax.swing.*
import javax.swing.table.DefaultTableModel

/**
 * Traces tool window — displays agent trace events streamed from the gateway.
 *
 * Shows a table with columns: Time, Type, Agent, Details.
 * Events are received via the gateway WebSocket event stream.
 */
class TracesPanel(@Suppress("unused") private val project: Project) : JPanel(BorderLayout()), MayrosService.ConnectionListener, Disposable {

    private val columnNames = arrayOf("Time", "Type", "Agent", "Details")
    private val tableModel = DefaultTableModel(columnNames, 0)
    private val traceTable = JTable(tableModel)
    private val clearButton = JButton("Clear")
    private val filterField = JTextField(12)
    private val filterButton = JButton("Filter")
    private val statusLabel = JLabel("Not connected")
    private val service = MayrosService.getInstance()
    private var maxEvents = 500

    // Track our own event listeners so we can remove only ours on reconnect
    private val registeredListeners = mutableListOf<Pair<String, (JsonObject) -> Unit>>()

    init {
        setupUI()
        service.addListener(this)
    }

    private fun setupUI() {
        // Trace table
        traceTable.autoResizeMode = JTable.AUTO_RESIZE_LAST_COLUMN
        traceTable.columnModel.getColumn(0).preferredWidth = 100
        traceTable.columnModel.getColumn(1).preferredWidth = 100
        traceTable.columnModel.getColumn(2).preferredWidth = 100
        traceTable.columnModel.getColumn(3).preferredWidth = 400

        val scrollPane = JBScrollPane(traceTable)
        add(scrollPane, BorderLayout.CENTER)

        // Top bar
        val buttonsPanel = JPanel(java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 4, 0)).apply {
            add(JLabel("Agent:"))
            add(filterField)
            add(filterButton)
            add(clearButton)
        }
        val topPanel = JPanel(BorderLayout()).apply {
            add(statusLabel, BorderLayout.CENTER)
            add(buttonsPanel, BorderLayout.EAST)
        }
        add(topPanel, BorderLayout.NORTH)

        clearButton.addActionListener {
            tableModel.rowCount = 0
            filterField.text = ""
        }

        filterButton.addActionListener { fetchFilteredEvents() }
    }

    private fun fetchFilteredEvents() {
        val client = service.getClient() ?: return
        if (!client.isConnected) return

        val agentId = filterField.text.trim().takeIf { it.isNotEmpty() }
        statusLabel.text = "Fetching..."

        Thread {
            try {
                val events = client.getTraceEvents(agentId, maxEvents)
                SwingUtilities.invokeLater {
                    tableModel.rowCount = 0
                    for (event in events) {
                        val time = event.get("timestamp")?.asString?.takeLast(12) ?: ""
                        val type = event.get("type")?.asString ?: ""
                        val agent = event.get("agentId")?.asString ?: ""
                        val fields = event.get("fields")?.asJsonObject
                        val details = fields?.entrySet()?.joinToString(", ") {
                            val v = try { it.value.asString } catch (_: Exception) { it.value.toString() }
                            "${it.key}=$v"
                        } ?: ""
                        tableModel.addRow(arrayOf(time, type, agent, details))
                    }
                    val label = if (agentId != null) "Filtered: $agentId" else "All events"
                    statusLabel.text = "$label — ${events.size} event(s)"
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    statusLabel.text = "Error: ${e.message}"
                }
            }
        }.apply { isDaemon = true }.start()
    }

    private fun clearRegisteredListeners() {
        // Unregister listeners from the current client before clearing the tracking list.
        // On reconnect the old client may still be alive briefly, so explicitly removing
        // listeners prevents duplicate event delivery and memory leaks.
        val client = service.getClient()
        if (client != null) {
            for ((event, listener) in registeredListeners) {
                client.off(event, listener)
            }
        }
        registeredListeners.clear()
    }

    private fun subscribeToTraceEvents() {
        val client = service.getClient() ?: return

        val traceListener: (JsonObject) -> Unit = { payload ->
            val time = payload.get("timestamp")?.asString?.takeLast(12) ?: ""
            val type = payload.get("type")?.asString ?: ""
            val agent = payload.get("agentId")?.asString ?: ""
            val fields = payload.get("fields")?.asJsonObject
            val details = fields?.entrySet()?.joinToString(", ") {
                val v = try { it.value.asString } catch (_: Exception) { it.value.toString() }
                "${it.key}=$v"
            } ?: ""

            SwingUtilities.invokeLater {
                if (tableModel.rowCount >= maxEvents) {
                    tableModel.removeRow(0)
                }
                tableModel.addRow(arrayOf(time, type, agent, details))

                // Auto-scroll to bottom
                val lastRow = traceTable.rowCount - 1
                if (lastRow >= 0) {
                    traceTable.scrollRectToVisible(traceTable.getCellRect(lastRow, 0, true))
                }
            }
        }

        client.on("trace.event", traceListener)
        registeredListeners.add("trace.event" to traceListener)
    }

    override fun onConnected() {
        SwingUtilities.invokeLater {
            statusLabel.text = "Connected — listening for events"
            clearRegisteredListeners()
            subscribeToTraceEvents()
        }
    }

    override fun onDisconnected(reason: String) {
        SwingUtilities.invokeLater {
            statusLabel.text = "Disconnected"
        }
    }

    override fun dispose() {
        service.removeListener(this)
        clearRegisteredListeners()
    }
}

class TracesPanelFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = TracesPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "", false).apply {
            setDisposer(panel)
        }
        toolWindow.contentManager.addContent(content)
    }
}
