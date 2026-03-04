package com.apilium.mayros.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.apilium.mayros.MayrosClient
import com.apilium.mayros.MayrosService
import java.util.UUID

/**
 * Editor context action: Send selected code to Mayros chat.
 *
 * Sends the selected text (with file context) to the active Mayros session.
 * Appears in the editor right-click context menu under "Mayros".
 */
class SendSelectionAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val selection = editor.selectionModel.selectedText ?: return
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE)
        val fileName = file?.name ?: "unknown"
        val language = file?.extension ?: ""

        val service = MayrosService.getInstance()
        val client = service.getClient()

        if (client == null || !client.isConnected) {
            return
        }

        val message = buildString {
            append("Here is code from `$fileName`")
            if (language.isNotEmpty()) append(" ($language)")
            append(":\n\n```$language\n")
            append(selection)
            append("\n```")
        }

        Thread {
            try {
                client.sendMessage(
                    MayrosClient.ChatMessage(
                        sessionKey = "jetbrains-${UUID.randomUUID().toString().take(8)}",
                        message = message,
                        runId = UUID.randomUUID().toString()
                    )
                )
            } catch (_: Exception) {
                // Best-effort
            }
        }.start()
    }

    override fun update(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR)
        val hasSelection = editor?.selectionModel?.hasSelection() == true
        val connected = MayrosService.getInstance().isConnected
        e.presentation.isEnabledAndVisible = hasSelection && connected
    }
}
