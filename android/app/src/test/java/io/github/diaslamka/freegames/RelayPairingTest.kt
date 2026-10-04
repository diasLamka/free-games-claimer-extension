package io.github.diaslamka.freegames

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.RelayLink
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.io.File

/**
 * Associer ce telephone au PC garde un secret dans le Keystore d'Android. Chez certains constructeurs le Keystore
 * echoue (ProviderException, KeyStoreException) : l'exception remontait du `scope.launch` de l'interface, sans catch,
 * et faisait planter l'appli au moment de coller ou de scanner le code.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = android.app.Application::class)
class RelayPairingTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val code = parseJson(File(System.getProperty("fixtures"), "relais.json").readText())!!.jsonObject["code"].str!!

    @Before
    fun notPaired() = runBlocking<Unit> {
        Graph.init(context)
        Graph.store.update { it.copy(relay = null) }
    }

    @Test
    fun aGoodCodeThatTheKeystoreCannotKeepIsReportedInsteadOfCrashing() = runBlocking {
        // Robolectric n'a pas de Keystore Android : c'est le cas d'un telephone dont le Keystore est en panne.
        assertEquals(RelayLink.PairResult.NOT_STORED, RelayLink.pair(context, code, 1L))
        // Pas de demi-association : sans secret garde, l'etat ne dit pas « associe ».
        assertNull(Graph.store.value.relay)
    }

    @Test
    fun whatIsNotACodeIsStillSaidSo() = runBlocking {
        assertEquals(RelayLink.PairResult.BAD_CODE, RelayLink.pair(context, "ceci n'est pas un code", 1L))
        assertNull(Graph.store.value.relay)
    }
}
