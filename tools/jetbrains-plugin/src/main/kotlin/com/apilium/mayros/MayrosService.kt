package com.apilium.mayros

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.apilium.mayros.settings.MayrosSettings

/**
 * Application-level service that manages the MayrosClient lifecycle.
 *
 * Provides a shared gateway connection used by all tool windows and actions.
 * Auto-connects based on settings and handles reconnection.
 */
@Service
class MayrosService : Disposable {

    private val log = Logger.getInstance(MayrosService::class.java)
    private var client: MayrosClient? = null
    private val listeners = mutableListOf<ConnectionListener>()

    interface ConnectionListener {
        fun onConnected()
        fun onDisconnected(reason: String)
    }

    val isConnected: Boolean get() = client?.isConnected == true

    /**
     * Get or create the client instance. Does NOT auto-connect.
     */
    fun getClient(): MayrosClient? = client

    /**
     * Connect to the Mayros gateway using current settings.
     */
    fun connect(): Boolean {
        val settings = MayrosSettings.getInstance()
        val url = settings.gatewayUrl

        if (client?.isConnected == true) {
            log.info("Already connected to Mayros gateway")
            return true
        }

        client?.dispose()

        val newClient = MayrosClient(
            url = url,
            options = MayrosClient.ClientOptions(
                maxReconnectAttempts = settings.maxReconnectAttempts,
                reconnectDelayMs = settings.reconnectDelayMs,
                requestTimeoutMs = 30000
            )
        )

        client = newClient
        log.info("Connecting to Mayros gateway at $url")

        val connected = newClient.connect()
        if (connected) {
            log.info("Connected to Mayros gateway")
            listeners.forEach { it.onConnected() }
        } else {
            log.warn("Failed to connect to Mayros gateway at $url")
            listeners.forEach { it.onDisconnected("connection failed") }
        }

        return connected
    }

    /**
     * Disconnect from the gateway.
     */
    fun disconnect() {
        client?.disconnect()
        listeners.forEach { it.onDisconnected("user requested") }
        log.info("Disconnected from Mayros gateway")
    }

    /**
     * Add a connection state listener.
     */
    fun addListener(listener: ConnectionListener) {
        listeners.add(listener)
    }

    fun removeListener(listener: ConnectionListener) {
        listeners.remove(listener)
    }

    override fun dispose() {
        client?.dispose()
        client = null
        listeners.clear()
    }

    companion object {
        fun getInstance(): MayrosService {
            return ApplicationManager.getApplication().getService(MayrosService::class.java)
        }
    }
}
