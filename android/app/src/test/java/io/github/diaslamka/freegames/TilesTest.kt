package io.github.diaslamka.freegames

import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.AppUpdate
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Tiles
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.ui.columnsFor
import io.github.diaslamka.freegames.ui.gridColumnsFor
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.io.File

/** Comment les jeux sont poses (1.25.0), et la mise a jour automatique de la veille de fond. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = android.app.Application::class)
class TilesTest {
    @Test
    fun theThreeLayoutsAreTheOnlyOnesAndAnythingElseIsLargeTiles() {
        assertEquals(listOf("cards", "list", "grid"), Tiles.ALL)
        assertEquals(Tiles.GRID, Tiles.of("grid"))
        assertEquals(Tiles.LIST, Tiles.of("list"))
        for (bad in listOf(null, "", "mosaic", "GRID", " list")) assertEquals("$bad", Tiles.CARDS, Tiles.of(bad))
    }

    @Test
    fun anOldSettingsFileGetsLargeTilesAndAutomaticUpdate() {
        // Une sauvegarde d'avant la 1.25.0 ne connait ni l'un ni l'autre : les valeurs par defaut.
        val old = Json { ignoreUnknownKeys = true }.decodeFromString(Settings.serializer(), """{"country":"FR","checkHours":3}""")
        assertEquals(Tiles.CARDS, old.tiles)
        assertTrue(old.autoUpdate)
        val chosen = Json.decodeFromString(Settings.serializer(), Json.encodeToString(Settings.serializer(), old.copy(tiles = Tiles.GRID, autoUpdate = false)))
        assertEquals(Tiles.GRID, chosen.tiles)
        assertFalse(chosen.autoUpdate)
    }

    @Test
    fun columnsFollowTheLayoutAndTheWidth() {
        // Grandes tuiles : une, deux, trois.
        assertEquals(listOf(1, 1, 2, 2, 3), listOf(360, 411, 600, 839, 1000).map { columnsFor(it.dp) })
        // Grille : deux au telephone, puis trois, puis quatre.
        assertEquals(listOf(2, 2, 3, 3, 4), listOf(360, 411, 600, 839, 1000).map { gridColumnsFor(it.dp) })
    }

    /* ----------------------------------- la veille de fond : au plus une fois par jour */

    private val release = AppUpdate.Release("1.25.0", "app-v1.25.0", 7, "free-games-claimer-android-1.25.0.apk", 100, null, "")

    private class Net(val body: String) : AppUpdate.Net {
        var calls = 0
        override suspend fun releases(token: String?): AppUpdate.Listing { calls++; return AppUpdate.Listing(200, body) }
        override suspend fun download(assetId: Long, token: String?, dest: File, onProgress: (Long, Long) -> Unit): Int = 404
    }

    private fun listing(version: String) =
        """[{"tag_name":"app-v$version","draft":false,"prerelease":false,"body":"","assets":[{"id":7,"name":"free-games-claimer-android-$version.apk","size":100,"state":"uploaded"}]}]"""

    @Test
    fun theBackgroundSearchAnswersOncePerDayAndTheNotificationOncePerVersion() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        context.getSharedPreferences("maj", android.content.Context.MODE_PRIVATE).edit().clear().commit()
        val net = Net(listing("1.25.0"))
        val t = 1_790_000_000_000L

        val first = AppUpdate.latest(context, net, null, "1.24.0", t)
        assertNotNull(first)
        assertEquals("1.25.0", first!!.version)
        assertNull("une seule recherche par jour", AppUpdate.latest(context, net, null, "1.24.0", t + 3_600_000L))
        assertEquals(1, net.calls)

        // Le lendemain : la meme version est encore la (l'installation automatique a pu echouer) -> on la rend de nouveau...
        assertEquals("1.25.0", AppUpdate.latest(context, net, null, "1.24.0", t + 25 * 3_600_000L)?.version)
        // ...mais la notification, elle, ne sonne qu'une fois par version.
        assertTrue(AppUpdate.firstTimeFor(context, "1.25.0"))
        assertFalse(AppUpdate.firstTimeFor(context, "1.25.0"))
        assertTrue(AppUpdate.firstTimeFor(context, "1.26.0"))

        // Rien de plus recent : rien.
        assertNull(AppUpdate.latest(context, Net(listing("1.24.0")), null, "1.24.0", t + 60 * 3_600_000L))
    }

    @Test
    fun theOldNotifyOnlyPathStillWorks() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        context.getSharedPreferences("maj", android.content.Context.MODE_PRIVATE).edit().clear().commit()
        val net = Net(listing("1.25.0"))
        val t = 1_790_000_000_000L
        assertEquals("1.25.0", AppUpdate.backgroundCheck(context, net, null, "1.24.0", t)?.version)
        assertNull("deja prevenu", AppUpdate.backgroundCheck(context, net, null, "1.24.0", t + 25 * 3_600_000L))
        assertNotNull(parseJson("{}"))
        assertEquals("1.25.0", release.version)
    }
}
