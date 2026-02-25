package ai.mayros.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class MayrosProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", MayrosCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", MayrosCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", MayrosCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", MayrosCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", MayrosCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", MayrosCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", MayrosCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", MayrosCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", MayrosCapability.Canvas.rawValue)
    assertEquals("camera", MayrosCapability.Camera.rawValue)
    assertEquals("screen", MayrosCapability.Screen.rawValue)
    assertEquals("voiceWake", MayrosCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", MayrosScreenCommand.Record.rawValue)
  }
}
