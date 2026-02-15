package com.tsc.imowatch

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.tsc.imowatch.theme.DealRadarTheme

class MainActivity : ComponentActivity() {
    private var deepLinkData: String? by mutableStateOf(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        deepLinkData = intent?.dataString
        setContent {
            DealRadarTheme {
                DealRadarApp(initialDeepLink = deepLinkData)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        deepLinkData = intent.dataString
    }
}
