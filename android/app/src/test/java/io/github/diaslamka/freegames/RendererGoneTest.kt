package io.github.diaslamka.freegames

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.claim.ClaimSession
import io.github.diaslamka.freegames.claim.RenderSafeClient
import io.github.diaslamka.freegames.claim.RendererGone
import io.github.diaslamka.freegames.claim.SessionProbe
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.LoginScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Le moteur de rendu d'une WebView peut etre tue (memoire) ou planter. Sans `onRenderProcessGone` qui rend `true`,
 * Android arrete TOUT le processus : la recuperation de fond « ecran eteint », sur un telephone qui manque de memoire,
 * emportait l'appli entiere. Ici la page est perdue, pas l'appli.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = android.app.Application::class)
class RendererGoneTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    private fun gone(crashed: Boolean) = object : RenderProcessGoneDetail() {
        override fun didCrash() = crashed
        override fun rendererPriorityAtExit() = 0
    }

    @Test
    fun theSharedClientNeverLetsAndroidKillTheApp() {
        var seen: Boolean? = null
        val client = RenderSafeClient { seen = it }
        val view = WebView(context)
        assertTrue(client.onRenderProcessGone(view, gone(true)))
        assertEquals(true, seen)
        assertTrue(client.onRenderProcessGone(view, gone(false)))
        assertEquals(false, seen)
    }

    @Test
    fun theProbeGivesUpOnAPageWhoseRendererIsGoneInsteadOfWaitingForIt() {
        val finished = CompletableDeferred<Unit>()
        var lost = false
        val client = SessionProbe.probeClient(finished) { lost = true }
        assertTrue(client.onRenderProcessGone(WebView(context), gone(false)))
        assertTrue(finished.isCompleted)
        assertTrue(lost)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun aClaimSessionThrowsTheDeadPageAwayAndFreesWhatWaitedForIt() {
        Graph.init(context)
        val session = ClaimSession(context, CoroutineScope(Job()))
        val dead = session.webView
        assertSame(dead, session.webView)

        val ready = CompletableDeferred<String>()
        val verdict = CompletableDeferred<kotlinx.serialization.json.JsonElement>()
        val load = CompletableDeferred<String>()
        val human = CompletableDeferred<Boolean>()
        session.ready = ready
        session.verdict = verdict
        session.pageLoad = load
        session.userDone = human

        session.rendererGone(dead, didCrash = true)

        // La page morte n'est plus rendue : la suivante en aura une neuve, et l'ecran est prevenu.
        assertNotSame(dead, session.webView)
        assertEquals(1, session.pages.value)
        // Ce qui l'attendait est libere tout de suite, avec la raison, au lieu d'attendre son delai (jusqu'a cinq minutes).
        for (wait in listOf<CompletableDeferred<*>>(ready, verdict, load)) {
            assertTrue(wait.isCompleted)
            assertTrue(wait.getCompletionExceptionOrNull() is RendererGone)
        }
        assertTrue(runBlocking { human.isCompleted && !human.await() })
    }

    @Test
    fun theLoginPageIsRebuiltTwiceWhenItsRendererIsGoneThenTheScreenCloses() {
        var closed = 0
        compose.setContent {
            FreeGamesTheme(dark = false) { LoginScreen(Stores.GOG, "FR", onClose = { closed++ }) }
        }
        compose.waitForIdle()
        var web = webViewOnScreen()
        repeat(2) {
            shadowOf(web).webViewClient.onRenderProcessGone(web, gone(false))
            compose.waitForIdle()
            val fresh = webViewOnScreen()
            // Une WebView neuve, a la meme page de connexion ; l'ecran reste ouvert.
            assertNotSame(web, fresh)
            assertEquals(0, closed)
            web = fresh
        }
        // Un moteur de rendu qui meurt a chaque fois : on n'insiste pas.
        shadowOf(web).webViewClient.onRenderProcessGone(web, gone(true))
        compose.waitForIdle()
        assertEquals(1, closed)
    }

    private fun webViewOnScreen(): WebView {
        fun find(v: View): WebView? {
            if (v is WebView) return v
            if (v is ViewGroup) for (i in 0 until v.childCount) find(v.getChildAt(i))?.let { return it }
            return null
        }
        return find(compose.activity.window.decorView) ?: error("aucune WebView a l'ecran")
    }
}
