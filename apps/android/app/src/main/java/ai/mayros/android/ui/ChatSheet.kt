package ai.mayros.android.ui

import androidx.compose.runtime.Composable
import ai.mayros.android.MainViewModel
import ai.mayros.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
