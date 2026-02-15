package com.tsc.imowatch

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService

class FcmTokenService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // TODO(doc-gap): Persist refreshed token when background auth/session bootstrap is defined.
        Log.d("DealRadarPT", "FCM token refreshed")
    }
}
