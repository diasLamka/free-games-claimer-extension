package io.github.diaslamka.freegames

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.AppUpdate
import io.github.diaslamka.freegames.data.AppUpdate.Status
import io.github.diaslamka.freegames.data.UpdateRunner
import io.github.diaslamka.freegames.notify.Notifier
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

/**
 * La mise a jour qu'on lance depuis la notification (1.29.0) : l'appui sur « Mise a jour disponible » ouvre l'appli ET
 * telecharge ; une notification dit la progression ; et elle disparait quand le systeme prend le relais ou en cas d'echec.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = android.app.Application::class)
class UpdateNotificationTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val manager: NotificationManager get() = context.getSystemService(NotificationManager::class.java)
    private val release = AppUpdate.Release("9.9.9", "app-v9.9.9", 7, "free-games-claimer-android-9.9.9.apk", 0, null, "")

    private val listing = """[{"tag_name":"app-v9.9.9","draft":false,"prerelease":false,"body":"",
        "assets":[{"id":7,"name":"free-games-claimer-android-9.9.9.apk","size":0,"state":"uploaded"}]}]"""

    /** Un reseau qui annonce 50 % puis attend qu'on l'ouvre ; ce qu'il livre n'est pas un APK. */
    private class GatedNet(val body: String, val gate: CompletableDeferred<Unit> = CompletableDeferred()) : AppUpdate.Net {
        var downloads = 0
        override suspend fun releases(token: String?) = AppUpdate.Listing(200, body)
        override suspend fun download(assetId: Long, token: String?, dest: File, onProgress: (Long, Long) -> Unit): Int {
            downloads++
            onProgress(50, 100)
            gate.await()
            dest.writeBytes("pas un apk".toByteArray())
            return 200
        }
    }

    @Before
    fun setUp() {
        shadowOf(context.packageManager).setCanRequestPackageInstalls(true)
        shadowOf(context as android.app.Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        AppUpdate.publish(Status.Idle)
    }

    @After
    fun reset() {
        UpdateRunner.net = { throw IllegalStateException("le reseau n'est pas remplace") }
        AppUpdate.publish(Status.Idle)
        manager.cancelAll()
    }

    private fun shown(id: Int): Notification? = shadowOf(manager).getNotification(id)

    private fun until(what: String, check: () -> Boolean) {
        val end = System.currentTimeMillis() + 10_000
        while (!check()) {
            if (System.currentTimeMillis() > end) throw AssertionError("jamais arrive : $what")
            Thread.sleep(20)
        }
    }

    /* ------------------------------------------------------------ l'appui sur la notification */

    @Test
    fun theAvailableNotificationOpensTheAppAskingForTheUpdate() {
        Notifier.updateAvailable(context, "9.9.9")
        val n = shown(Notifier.ID_UPDATE)
        assertNotNull(n)
        val sent = shadowOf(n!!.contentIntent).savedIntent
        assertEquals(MainActivity::class.java.name, sent.component?.className)
        assertEquals("9.9.9", sent.getStringExtra(MainActivity.EXTRA_UPDATE))
    }

    @Test
    fun tappingItSearchesThenDownloads() {
        val net = GatedNet(listing)
        UpdateRunner.net = { net }
        val job = runBlocking { UpdateRunner.fromNotification(context) }
        assertNotNull(job)
        until("le telechargement") { net.downloads == 1 }
        net.gate.complete(Unit)
        runBlocking { withTimeout(10_000) { job!!.join() } }
        assertEquals(1, net.downloads)
    }

    @Test
    fun tappingItWhenThereIsNothingNewStartsNothing() {
        val net = GatedNet("[]")
        UpdateRunner.net = { net }
        assertNull(runBlocking { UpdateRunner.fromNotification(context) })
        assertEquals(0, net.downloads)
    }

    /* ------------------------------------------------------------ la progression */

    @Test
    fun aDownloadShowsAProgressNotificationThatLeavesWhenItEnds() {
        val net = GatedNet(listing)
        UpdateRunner.net = { net }
        val job = UpdateRunner.installInBackground(context, release)
        until("la notification de progression") { shown(Notifier.ID_UPDATE_PROGRESS) != null }
        val n = shown(Notifier.ID_UPDATE_PROGRESS)!!
        assertEquals(50, n.extras.getInt(Notification.EXTRA_PROGRESS))
        assertEquals(100, n.extras.getInt(Notification.EXTRA_PROGRESS_MAX))
        assertTrue("on ne la balaie pas pendant que ca telecharge", n.flags and Notification.FLAG_ONGOING_EVENT != 0)

        net.gate.complete(Unit)
        runBlocking { withTimeout(10_000) { job!!.join() } }
        until("la notification retiree") { shown(Notifier.ID_UPDATE_PROGRESS) == null }
    }

    @Test
    fun startingTheDownloadClearsTheAvailableNotification() {
        Notifier.updateAvailable(context, "9.9.9")
        val net = GatedNet(listing)
        UpdateRunner.net = { net }
        val job = UpdateRunner.installInBackground(context, release)
        until("la notification de progression") { shown(Notifier.ID_UPDATE_PROGRESS) != null }
        assertNull(shown(Notifier.ID_UPDATE))
        net.gate.complete(Unit)
        runBlocking { withTimeout(10_000) { job!!.join() } }
    }
}
