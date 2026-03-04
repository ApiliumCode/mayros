package com.apilium.mayros.gutter

import com.intellij.codeInsight.daemon.LineMarkerInfo
import com.intellij.codeInsight.daemon.LineMarkerProvider
import com.intellij.openapi.editor.markup.GutterIconRenderer
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiComment
import com.intellij.icons.AllIcons
import com.apilium.mayros.MayrosClient
import com.apilium.mayros.MayrosService
import java.util.UUID

/**
 * Gutter line marker provider for Mayros integration.
 *
 * Adds a gutter icon next to TODO/FIXME comments that allows sending
 * the comment context to Mayros for analysis or resolution.
 */
class MayrosLineMarkerProvider : LineMarkerProvider {

    override fun getLineMarkerInfo(element: PsiElement): LineMarkerInfo<*>? {
        if (element !is PsiComment) return null

        val text = element.text
        if (!isMayrosMarker(text)) return null

        return LineMarkerInfo(
            element,
            element.textRange,
            AllIcons.General.Information,
            { "Send to Mayros: ${extractMarkerText(text)}" },
            { _, _ ->
                sendToMayros(text, element)
            },
            GutterIconRenderer.Alignment.RIGHT,
            { "Send to Mayros" }
        )
    }

    private fun isMayrosMarker(text: String): Boolean {
        val lower = text.lowercase()
        return lower.contains("todo") ||
            lower.contains("fixme") ||
            lower.contains("hack") ||
            lower.contains("mayros:")
    }

    private fun extractMarkerText(commentText: String): String {
        return commentText
            .removePrefix("//")
            .removePrefix("/*")
            .removeSuffix("*/")
            .trim()
            .take(80)
    }

    private fun sendToMayros(commentText: String, element: PsiElement) {
        val service = MayrosService.getInstance()
        val client = service.getClient() ?: return
        if (!client.isConnected) return

        val file = element.containingFile?.virtualFile?.name ?: "unknown"
        val line = element.containingFile?.let { psiFile ->
            val doc = com.intellij.psi.PsiDocumentManager.getInstance(psiFile.project)
                .getDocument(psiFile)
            doc?.getLineNumber(element.textOffset)?.plus(1)
        } ?: 0

        val message = buildString {
            append("Found a marker comment in `$file` at line $line:\n\n")
            append("```\n${extractMarkerText(commentText)}\n```\n\n")
            append("Please analyze this and suggest a resolution or improvement.")
        }

        Thread {
            try {
                client.sendMessage(
                    MayrosClient.ChatMessage(
                        sessionKey = "jetbrains-gutter",
                        message = message,
                        runId = UUID.randomUUID().toString()
                    )
                )
            } catch (_: Exception) {
                // Best-effort
            }
        }.start()
    }
}
