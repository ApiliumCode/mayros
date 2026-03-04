package com.apilium.mayros.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.options.Configurable
import java.awt.BorderLayout
import java.awt.GridLayout
import javax.swing.*

/**
 * Persistent settings state for the Mayros plugin.
 */
@State(
    name = "MayrosSettings",
    storages = [Storage("mayros.xml")]
)
class MayrosSettings : PersistentStateComponent<MayrosSettings.State> {

    data class State(
        var gatewayUrl: String = "ws://127.0.0.1:18789",
        var autoConnect: Boolean = true,
        var reconnectDelayMs: Long = 3000,
        var maxReconnectAttempts: Int = 5
    )

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    var gatewayUrl: String
        get() = state.gatewayUrl
        set(value) { state.gatewayUrl = value }

    var autoConnect: Boolean
        get() = state.autoConnect
        set(value) { state.autoConnect = value }

    var reconnectDelayMs: Long
        get() = state.reconnectDelayMs
        set(value) { state.reconnectDelayMs = value }

    var maxReconnectAttempts: Int
        get() = state.maxReconnectAttempts
        set(value) { state.maxReconnectAttempts = value }

    companion object {
        fun getInstance(): MayrosSettings {
            return ApplicationManager.getApplication().getService(MayrosSettings::class.java)
        }
    }
}

/**
 * Settings configurable panel — appears under Tools > Mayros in IDE settings.
 */
class MayrosConfigurable : Configurable {

    private var panel: JPanel? = null
    private var urlField: JTextField? = null
    private var autoConnectBox: JCheckBox? = null
    private var reconnectDelayField: JTextField? = null
    private var maxAttemptsField: JTextField? = null

    override fun getDisplayName(): String = "Mayros"

    override fun createComponent(): JComponent {
        val settings = MayrosSettings.getInstance()

        urlField = JTextField(settings.gatewayUrl, 30)
        autoConnectBox = JCheckBox("Auto-connect on startup", settings.autoConnect)
        reconnectDelayField = JTextField(settings.reconnectDelayMs.toString(), 10)
        maxAttemptsField = JTextField(settings.maxReconnectAttempts.toString(), 10)

        val formPanel = JPanel(GridLayout(4, 2, 8, 8)).apply {
            add(JLabel("Gateway URL:"))
            add(urlField)
            add(JLabel("Auto-connect:"))
            add(autoConnectBox)
            add(JLabel("Reconnect delay (ms):"))
            add(reconnectDelayField)
            add(JLabel("Max reconnect attempts:"))
            add(maxAttemptsField)
        }

        panel = JPanel(BorderLayout()).apply {
            add(formPanel, BorderLayout.NORTH)
        }

        return panel!!
    }

    override fun isModified(): Boolean {
        val settings = MayrosSettings.getInstance()
        return urlField?.text != settings.gatewayUrl ||
            autoConnectBox?.isSelected != settings.autoConnect ||
            reconnectDelayField?.text != settings.reconnectDelayMs.toString() ||
            maxAttemptsField?.text != settings.maxReconnectAttempts.toString()
    }

    override fun apply() {
        val settings = MayrosSettings.getInstance()
        settings.gatewayUrl = urlField?.text ?: settings.gatewayUrl
        settings.autoConnect = autoConnectBox?.isSelected ?: settings.autoConnect
        settings.reconnectDelayMs = reconnectDelayField?.text?.toLongOrNull() ?: settings.reconnectDelayMs
        settings.maxReconnectAttempts = maxAttemptsField?.text?.toIntOrNull() ?: settings.maxReconnectAttempts
    }

    override fun reset() {
        val settings = MayrosSettings.getInstance()
        urlField?.text = settings.gatewayUrl
        autoConnectBox?.isSelected = settings.autoConnect
        reconnectDelayField?.text = settings.reconnectDelayMs.toString()
        maxAttemptsField?.text = settings.maxReconnectAttempts.toString()
    }

    override fun disposeUIResources() {
        panel = null
        urlField = null
        autoConnectBox = null
        reconnectDelayField = null
        maxAttemptsField = null
    }
}
