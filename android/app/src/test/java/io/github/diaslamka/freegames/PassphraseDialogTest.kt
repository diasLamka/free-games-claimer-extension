package io.github.diaslamka.freegames

import android.app.Application
import android.content.Context
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.BackupVault
import io.github.diaslamka.freegames.ui.PassphraseDialog
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** La phrase de passe de la sauvegarde : saisie deux fois a l'export (personne ne peut la retrouver), une fois a la restauration, jamais a l'ecran. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class)
class PassphraseDialogTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private fun str(id: Int, vararg a: Any) = context.getString(id, *a)

    private fun show(confirm: Boolean, onOk: (String) -> Unit = {}) =
        compose.setContent { FreeGamesTheme(dark = false) { PassphraseDialog(confirm, onOk, onDismiss = {}) } }

    private fun fields() = compose.onAllNodes(hasSetTextAction())
    private fun ok() = compose.onNodeWithText(str(R.string.passphrase_ok), ignoreCase = true)

    @Test
    fun anExportAsksTwiceAndAcceptsOnlyALongEnoughPhraseTypedTwice() {
        var got: String? = null
        show(confirm = true) { got = it }
        fields().assertCountEquals(2)
        ok().assertIsNotEnabled()

        fields()[0].performTextInput("court")
        compose.onNodeWithText(str(R.string.passphrase_short, BackupVault.MIN_PASSPHRASE), ignoreCase = true).assertExists()
        ok().assertIsNotEnabled()

        fields()[0].performTextReplacement("une phrase assez longue")
        fields()[1].performTextInput("autre chose")
        compose.onNodeWithText(str(R.string.passphrase_mismatch), ignoreCase = true).assertExists()
        ok().assertIsNotEnabled()

        fields()[1].performTextReplacement("une phrase assez longue")
        ok().assertIsEnabled().performClick()
        assertEquals("une phrase assez longue", got)
    }

    @Test
    fun aRestoreAsksOnceAndAcceptsAnyPhrase() {
        var got: String? = null
        show(confirm = false) { got = it }
        fields().assertCountEquals(1)
        ok().assertIsNotEnabled()
        fields()[0].performTextInput("x")
        ok().assertIsEnabled().performClick()
        assertEquals("x", got)
    }

    @Test
    fun anExportWarnsThatThePhraseCannotBeRecovered() {
        show(confirm = true)
        compose.onNodeWithText(str(R.string.passphrase_warning), ignoreCase = true).assertExists()
    }

    @Test
    fun thePhraseIsNeverShownOnScreen() {
        show(confirm = true)
        // Les deux champs sont des champs de mot de passe : masques, sans suggestion.
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Password)).assertCountEquals(2)
    }

    @Test
    fun nothingIsReturnedUntilTheUserConfirms() {
        var got: String? = null
        show(confirm = true) { got = it }
        fields()[0].performTextInput("une phrase assez longue")
        assertNull(got)
    }
}
