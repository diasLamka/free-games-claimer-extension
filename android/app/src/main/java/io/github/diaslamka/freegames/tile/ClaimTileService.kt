package io.github.diaslamka.freegames.tile

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import io.github.diaslamka.freegames.MainActivity
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.widget.FreeNowWidget
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * La tuile (1.46.0) : une tuile des reglages rapides d'Android, a tirer du haut de l'ecran. Elle dit combien de jeux gratuits
 * sont a prendre, et un appui lance « Tout recuperer » -- zero ouverture d'appli a la main.
 *
 * Elle ne fait QU'UN GESTE, le meme que le bouton du widget « Gratuit maintenant » : ouvrir l'appli sur l'onglet des jeux en
 * demandant la recuperation, que l'appli mene sous les yeux de l'utilisateur. Rien ne tourne dans la tuile, et rien ne part
 * sans un appui. Elle se redessine chaque fois que le panneau s'ouvre (`onStartListening`), d'apres l'etat de l'appli.
 */
class ClaimTileService : TileService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Ce que la tuile a montre en dernier : un appui sait ainsi s'il y a quelque chose a prendre. */
    @Volatile private var shown: ClaimTile.Face? = null

    override fun onStartListening() {
        super.onStartListening()
        scope.launch {
            Graph.init(applicationContext)
            val face = ClaimTile.face(Graph.store.value, System.currentTimeMillis())
            shown = face
            withContext(Dispatchers.Main) { paint(face) }
        }
    }

    override fun onClick() {
        super.onClick()
        if (isLocked) unlockAndRun { open() } else open()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun paint(face: ClaimTile.Face) {
        val tile = qsTile ?: return
        tile.label = getString(R.string.section_free)
        tile.state = if (face.free > 0) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        if (Build.VERSION.SDK_INT >= 29) {
            tile.subtitle = if (face.free > 0) resources.getQuantityString(R.plurals.pending_claims, face.free, face.free)
            else getString(R.string.widget_free_none_title)
        }
        tile.updateTile()
    }

    private fun open() {
        val intent = ClaimTile.launch(this, claim = (shown?.claimable ?: 0) > 0)
        if (Build.VERSION.SDK_INT >= 34) {
            // Depuis Android 14, startActivityAndCollapse(Intent) est refuse aux applis recentes : un PendingIntent.
            startActivityAndCollapse(
                PendingIntent.getActivity(this, REQUEST, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
            )
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    private companion object {
        /** Les widgets prennent 81 et 82. */
        const val REQUEST = 83
    }
}

/** Ce que la tuile sait calculer sans rien toucher d'Android : pur, donc teste. */
object ClaimTile {
    /** `free` : les jeux gratuits a toi pas encore ; `claimable` : parmi eux, ceux que l'appli sait prendre. */
    data class Face(val free: Int, val claimable: Int)

    fun face(s: AppState, now: Long): Face {
        val liste = FreeNowWidget.items(s, now)
        return Face(free = liste.size, claimable = liste.count { Rules.claimable(it, s.settings) })
    }

    /** L'intent d'un appui : l'onglet des jeux, et « tout recuperer » seulement s'il y a quelque chose a prendre. */
    fun launch(context: Context, claim: Boolean): Intent =
        Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_TAB, 0)
            .apply { if (claim) putExtra(MainActivity.EXTRA_CLAIM, "*").setAction("claim:*") }
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
}
