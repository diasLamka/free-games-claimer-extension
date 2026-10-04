package io.github.diaslamka.freegames

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.AppUpdate
import io.github.diaslamka.freegames.data.AppUpdate.Reason
import io.github.diaslamka.freegames.data.AppUpdate.Status
import io.github.diaslamka.freegames.data.UpdateRunner
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

/**
 * Le telechargement de la mise a jour vit autant que le processus, pas que le bandeau ou la section des Reglages
 * qui l'a lance : un bandeau qui sort de la liste (defilement, autre onglet) annulait sa coroutine, et le
 * telechargement avec elle.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = android.app.Application::class)
class UpdateRunnerTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val release = AppUpdate.Release("1.27.0", "app-v1.27.0", 7, "free-games-claimer-android-1.27.0.apk", 0, null, "")

    /** Un reseau dont le telechargement attend qu'on l'ouvre ; ce qu'il livre n'est pas un APK. */
    private class GatedNet(val gate: CompletableDeferred<Unit> = CompletableDeferred()) : AppUpdate.Net {
        var downloads = 0
        override suspend fun releases(token: String?) = AppUpdate.Listing(200, "[]")
        override suspend fun download(assetId: Long, token: String?, dest: File, onProgress: (Long, Long) -> Unit): Int {
            downloads++
            gate.await()
            dest.writeBytes("pas un apk".toByteArray())
            return 200
        }
    }

    @Before
    fun allowInstalls() {
        shadowOf(context.packageManager).setCanRequestPackageInstalls(true)
        AppUpdate.publish(Status.Idle)
    }

    @After
    fun reset() {
        UpdateRunner.net = { throw IllegalStateException("le reseau n'est pas remplace") }
        AppUpdate.publish(Status.Idle)
    }

    private fun join(job: kotlinx.coroutines.Job?) = runBlocking { withTimeout(10_000) { job!!.join() } }

    @Test
    fun theInstallRunsToItsEndOnItsOwnWithoutAnyScreen() {
        val net = GatedNet()
        UpdateRunner.net = { net }
        val job = UpdateRunner.installInBackground(context, release)
        assertNotNull(job)
        // Personne ne l'attend : il va jusqu'au bout quand le reseau repond, et dit ce qu'il a trouve.
        net.gate.complete(Unit)
        join(job)
        assertEquals(Status.Failed(Reason.WRONG_APP), AppUpdate.status.value)
    }

    @Test
    fun aSecondTapWhileItDownloadsStartsNothing() {
        val net = GatedNet()
        UpdateRunner.net = { net }
        val first = UpdateRunner.installInBackground(context, release)
        assertNotNull(first)
        assertNull(UpdateRunner.installInBackground(context, release))
        net.gate.complete(Unit)
        join(first)
        assertEquals(1, net.downloads)
    }

    @Test
    fun whenAndroidHasNotAllowedInstallsTheCallerIsToldOnceAndNothingIsDownloaded() {
        shadowOf(context.packageManager).setCanRequestPackageInstalls(false)
        val net = GatedNet()
        UpdateRunner.net = { net }
        var asked = 0
        val job = UpdateRunner.installInBackground(context, release) { asked++ }
        join(job)
        assertEquals(1, asked)
        assertEquals(0, net.downloads)
        assertEquals(Status.Idle, AppUpdate.status.value)
    }
}
