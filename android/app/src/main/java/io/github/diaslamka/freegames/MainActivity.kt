package io.github.diaslamka.freegames

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import io.github.diaslamka.freegames.claim.ClaimSession
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.ui.AppRoot
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    companion object {
        const val EXTRA_TAB = "onglet"
        const val EXTRA_CLAIM = "recuperer"
    }

    private lateinit var session: ClaimSession
    private val intents = MutableStateFlow<Intent?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Graph.init(this)
        session = ClaimSession(this, lifecycleScope)
        intents.value = intent
        setContent {
            FreeGamesTheme {
                AppRoot(session = session, intents = intents, onIntentHandled = { intents.value = null })
            }
        }
    }

    override fun onStart() {
        super.onStart()
        io.github.diaslamka.freegames.data.Install.visible = true
    }

    override fun onStop() {
        io.github.diaslamka.freegames.data.Install.visible = false
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        // L'appli est a l'ecran : l'alarme de derniere chance a ete entendue.
        io.github.diaslamka.freegames.notify.Notifier.silenceLastChance(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intents.value = intent
    }

    override fun onDestroy() {
        session.release()
        super.onDestroy()
    }
}
