package com.apilium.mayros.ui

import com.apilium.mayros.MayrosService
import com.intellij.openapi.Disposable
import java.awt.BorderLayout
import java.awt.GridLayout
import javax.swing.*

/**
 * Quick settings panel for embedding in tool windows.
 *
 * Provides connect/disconnect buttons and displays connection status.
 * For full settings, use the IDE Settings > Tools > Mayros configurable.
 */
class SettingsPanel : JPanel(BorderLayout()), MayrosService.ConnectionListener, Disposable {

    private val connectButton = JButton("Connect")
    private val disconnectButton = JButton("Disconnect")
    private val statusLabel = JLabel("Not connected")
    private val service = MayrosService.getInstance()

    init {
        setupUI()
        service.addListener(this)
        updateButtonState()
    }

    private fun setupUI() {
        val buttonPanel = JPanel(GridLayout(1, 2, 8, 0)).apply {
            add(connectButton)
            add(disconnectButton)
        }

        add(statusLabel, BorderLayout.NORTH)
        add(buttonPanel, BorderLayout.CENTER)

        connectButton.addActionListener {
            statusLabel.text = "Connecting..."
            Thread {
                val ok = service.connect()
                SwingUtilities.invokeLater {
                    statusLabel.text = if (ok) "Connected" else "Connection failed"
                    updateButtonState()
                }
            }.apply { isDaemon = true }.start()
        }

        disconnectButton.addActionListener {
            service.disconnect()
            updateButtonState()
        }
    }

    private fun updateButtonState() {
        connectButton.isEnabled = !service.isConnected
        disconnectButton.isEnabled = service.isConnected
    }

    override fun onConnected() {
        SwingUtilities.invokeLater {
            statusLabel.text = "Connected"
            updateButtonState()
        }
    }

    override fun onDisconnected(reason: String) {
        SwingUtilities.invokeLater {
            statusLabel.text = "Disconnected: $reason"
            updateButtonState()
        }
    }

    override fun dispose() {
        service.removeListener(this)
    }
}
