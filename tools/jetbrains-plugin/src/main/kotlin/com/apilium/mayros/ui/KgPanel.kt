package com.apilium.mayros.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.apilium.mayros.MayrosService
import java.awt.BorderLayout
import java.awt.FlowLayout
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.*
import javax.swing.table.DefaultTableModel

/**
 * Knowledge Graph tool window — search and explore Cortex triples.
 *
 * Top bar: search field + limit spinner + search button.
 * Body: table with Subject, Predicate, Object, ID columns.
 * Double-click a row to re-query with that row's subject.
 */
class KgPanel(@Suppress("unused") private val project: Project) : JPanel(BorderLayout()), MayrosService.ConnectionListener, Disposable {

    private val searchField = JTextField(20)
    private val limitSpinner = JSpinner(SpinnerNumberModel(50, 1, 500, 10))
    private val searchButton = JButton("Search")
    private val statusLabel = JLabel("Not connected")
    private val columnNames = arrayOf("Subject", "Predicate", "Object", "ID")
    private val tableModel = DefaultTableModel(columnNames, 0)
    private val resultTable = JTable(tableModel)

    private val service = MayrosService.getInstance()

    init {
        setupUI()
        service.addListener(this)
    }

    private fun setupUI() {
        // Top bar
        val topPanel = JPanel(FlowLayout(FlowLayout.LEFT)).apply {
            add(JLabel("Query:"))
            add(searchField)
            add(JLabel("Limit:"))
            add(limitSpinner)
            add(searchButton)
            add(statusLabel)
        }
        add(topPanel, BorderLayout.NORTH)

        // Result table
        resultTable.autoResizeMode = JTable.AUTO_RESIZE_LAST_COLUMN
        resultTable.columnModel.getColumn(0).preferredWidth = 200
        resultTable.columnModel.getColumn(1).preferredWidth = 150
        resultTable.columnModel.getColumn(2).preferredWidth = 200
        resultTable.columnModel.getColumn(3).preferredWidth = 100
        add(JBScrollPane(resultTable), BorderLayout.CENTER)

        // Enter in search field triggers search
        searchField.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(e: KeyEvent) {
                if (e.keyCode == KeyEvent.VK_ENTER) search()
            }
        })

        searchButton.addActionListener { search() }

        // Double-click on row → re-query with that subject
        resultTable.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 2) {
                    val row = resultTable.selectedRow
                    if (row >= 0) {
                        val subject = tableModel.getValueAt(row, 0) as? String ?: return
                        searchField.text = subject
                        search()
                    }
                }
            }
        })
    }

    private fun search() {
        val client = service.getClient()
        if (client == null || !client.isConnected) {
            statusLabel.text = "Not connected"
            return
        }

        val query = searchField.text.trim()
        if (query.isEmpty()) return

        val limit = (limitSpinner.value as Number).toInt()
        statusLabel.text = "Searching..."

        Thread {
            try {
                val entries = client.queryKg(query, limit)
                SwingUtilities.invokeLater {
                    tableModel.rowCount = 0
                    for (entry in entries) {
                        tableModel.addRow(arrayOf(entry.subject, entry.predicate, entry.objectValue, entry.id))
                    }
                    statusLabel.text = "${entries.size} result(s)"
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    statusLabel.text = "Error: ${e.message}"
                }
            }
        }.apply { isDaemon = true }.start()
    }

    override fun onConnected() {
        SwingUtilities.invokeLater { statusLabel.text = "Connected" }
    }

    override fun onDisconnected(reason: String) {
        SwingUtilities.invokeLater {
            statusLabel.text = "Disconnected"
            tableModel.rowCount = 0
        }
    }

    override fun dispose() {
        service.removeListener(this)
    }
}

class KgPanelFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = KgPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "", false)
        toolWindow.contentManager.addContent(content)
    }
}
