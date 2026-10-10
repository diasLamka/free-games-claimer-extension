package io.github.diaslamka.freegames

import android.content.Context
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.AppUpdate
import io.github.diaslamka.freegames.ui.UpdateBanner
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Le bandeau de mise a jour de l'accueil (1.25.0) : il lit l'etat de la mise a jour tant que l'ecran est la, et
 * le suit quand il change. Le texte d'un Notice est mis en majuscules : on compare sans la casse.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class)
class UpdateBannerTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val release = AppUpdate.Release("1.27.0", "app-v1.27.0", 7, "free-games-claimer-android-1.27.0.apk", 100, null, "")

    // L'etat de la mise a jour est unique pour tout le processus : on le rend comme on l'a trouve.
    @After
    fun reset() {
        AppUpdate.publish(AppUpdate.Status.Idle)
    }

    private fun show() = compose.setContent { FreeGamesTheme(dark = false) { UpdateBanner() } }

    private fun text(id: Int, vararg args: Any) = context.getString(id, *args)

    @Test
    fun nothingShowsWhenThereIsNothingToSay() {
        AppUpdate.publish(AppUpdate.Status.Idle)
        show()
        compose.onNodeWithText(text(R.string.update_now), ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun aNewerVersionShowsTheBannerAndItsButton() {
        AppUpdate.publish(AppUpdate.Status.Available(release))
        show()
        compose.onNodeWithText(text(R.string.update_banner, "1.27.0"), ignoreCase = true).assertExists()
        compose.onNodeWithText(text(R.string.update_now), ignoreCase = true).assertExists()
    }

    @Test
    fun theBannerFollowsTheStateWhileTheScreenIsOn() {
        AppUpdate.publish(AppUpdate.Status.Idle)
        show()
        AppUpdate.publish(AppUpdate.Status.Downloading(release, 42))
        compose.waitForIdle()
        compose.onNodeWithText(text(R.string.update_downloading, 42), ignoreCase = true).assertExists()
        AppUpdate.publish(AppUpdate.Status.Installing)
        compose.waitForIdle()
        compose.onNodeWithText(text(R.string.update_installing), ignoreCase = true).assertExists()
    }

    private val hasProgress = SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)

    private fun progress() = compose.onNode(hasProgress).fetchSemanticsNode().config[SemanticsProperties.ProgressBarRangeInfo].current

    @Test
    fun theDownloadHasARealProgressBarThatFollowsThePercentage() {
        AppUpdate.publish(AppUpdate.Status.Downloading(release, 42))
        show()
        compose.onNode(hasProgress).assertExists()
        assertEquals(0.42f, progress(), 0.001f)
        AppUpdate.publish(AppUpdate.Status.Downloading(release, 80))
        compose.waitForIdle()
        assertEquals(0.80f, progress(), 0.001f)
    }

    @Test
    fun noBarWhenNothingIsDownloading() {
        AppUpdate.publish(AppUpdate.Status.Available(release))
        show()
        compose.onNode(hasProgress).assertDoesNotExist()
    }
}
