package io.github.diaslamka.freegames

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import io.github.diaslamka.freegames.data.Graph
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper

/**
 * L'appli entiere, telle qu'on l'ouvre : Application, activite, premier
 * passage de la veille sur le vrai reseau, ecran des jeux. Sur demande
 * (reseau) : ./gradlew testDebugUnitTest -Pscreens=true --tests '*StartupTest*'
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w400dp-h880dp-night-xxhdpi")
class StartupTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun opensAndChecks() {
        assumeTrue(System.getProperty("fgc.screens") == "true")
        // Robolectric n'a pas de vrai navigateur : pas de recuperation a l'ouverture ici.
        runBlocking { Graph.store.update { it.copy(settings = it.settings.copy(claimOnOpen = false, onboarded = true)) } }
        ActivityScenario.launch(MainActivity::class.java).use {
            val end = System.currentTimeMillis() + 30_000
            while (System.currentTimeMillis() < end && Graph.store.value.lastCheck == null) {
                Thread.sleep(200)
                ShadowLooper.idleMainLooper()
            }
            repeat(20) { Thread.sleep(100); ShadowLooper.idleMainLooper() }
            compose.waitUntil(5_000) { compose.onAllNodes(hasText("Jeux gratuits")).fetchSemanticsNodes().isNotEmpty() }
            val s = Graph.store.value
            check(s.lastCheck != null) { "le premier passage n'a pas eu lieu" }
            check(s.offers.isNotEmpty()) { "aucune offre lue : ${s.sources}" }
            println("DEMARRAGE : ${s.offers.size} offres, sources ${s.sources.mapValues { it.value.ok }}")
            compose.onRoot().captureRoboImage("${System.getProperty("screenshots")}/0-demarrage.png")
        }
    }
}
