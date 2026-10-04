package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Diagnostic
import io.github.diaslamka.freegames.data.PassLog
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.ImportedWish
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Member
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.PassRecord
import io.github.diaslamka.freegames.model.RelayState
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.SourceStatus
import io.github.diaslamka.freegames.model.Stores
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Le diagnostic partageable (1.27.0) : ce qu'il faut pour comprendre une veille qui ne tourne pas, SANS rien de personnel.
 * Il part par le menu « Partager » d'Android : ni cookies, ni identifiants, ni noms de proches, ni titres de la bibliotheque.
 */
class DiagnosticTest {
    private val hour = 3_600_000L
    private val now = 1_790_000_000_000L
    private val env = Diagnostic.Env(
        appVersion = "1.27.0", versionCode = 32, engineVersion = "2.107.0", androidRelease = "14", sdk = 34, device = "OnePlus CPH2173",
        notificationsAllowed = false, ignoringBatteryOptimizations = false, updateSilence = "FIRST_TIME",
    )

    private fun offer(title: String, store: String = Stores.EPIC, id: String = "x") =
        Offer(key = Offer.keyFor(store, id, title), source = "x", store = store, storeId = id, title = title, url = "https://example.test/$id", end = now + hour)

    /** Un etat chargé de secrets, que le diagnostic ne doit pas laisser passer. */
    private val secretive: AppState = run {
        val hades = offer("Hades")
        AppState(
            offers = mapOf(hades.key to hades),
            accounts = mapOf(Stores.GOG to AccountState(Accounts.OK, now - hour, name = "UtilisateurSecret", via = Accounts.PAGE)),
            engine = mapOf("FGC_cookie" to JsonPrimitive("SESSION=jeton-confidentiel")),
            wishlist = listOf("Mon Souhait Prive"),
            importedWishes = listOf(ImportedWish("Souhait Importe Prive", Stores.GOG, "g1")),
            library = mapOf("epic:a" to LibraryEntry(Stores.EPIC, "a", "Livre Prive de la Bibliotheque")),
            family = listOf(Member(id = "m1", name = "Mamie Jeanne")),
            relay = RelayState(dev = "c0ffee01", pairedAt = now - 5 * hour, lastError = "https://serveur-secret.example/topic"),
            lastCheck = now - 2 * hour,
            settings = Settings(checkHours = 3, claimInBackground = true),
            sources = mapOf("epic" to SourceStatus(now - hour, true, 5), "gog" to SourceStatus(now - hour, false, 0, "HTTP 502")),
            attempts = mapOf(hades.key to Attempt(count = 2, lastAt = now - hour, verdict = Verdicts.FAILURE, details = "le moteur ne s'est pas annonce")),
            watchLog = listOf(
                PassRecord(at = now - 2 * hour, ms = 4_200, reason = "fond", outcome = PassLog.OK, offers = 14, fresh = 1, screenOff = true, claimed = 0),
                PassRecord(at = now - 5 * hour, ms = 900, reason = "fond", outcome = PassLog.FAILED, errors = listOf("reseau coupe")),
            ),
        )
    }

    private val text = Diagnostic.build(secretive, env, now)

    @Test
    fun itSaysWhatIsNeededToUnderstandAWatchThatDoesNotRun() {
        for (needle in listOf(
            "1.27.0", "32", "2.107.0", "Android 14", "API 34", "OnePlus CPH2173",
            "notifications: off", "battery optimisation: restricted",
            // La veille : le dernier passage, et chaque passage du journal.
            "fond ok", "14 offers", "4200 ms", "screen off", "fond failed", "reseau coupe",
            // Les magasins et les sources, sans identifiant.
            "gog: ${Accounts.OK}", "via ${Accounts.PAGE}", "HTTP 502",
            // Les echecs de recuperation.
            "Hades", Verdicts.FAILURE, "le moteur ne s'est pas annonce",
            "claim in background: yes",
        )) assertTrue("manque « $needle » dans :\n$text", text.contains(needle, ignoreCase = true))
    }

    @Test
    fun itCarriesNothingPersonal() {
        for (secret in listOf(
            "UtilisateurSecret", "jeton-confidentiel", "SESSION=", "Mon Souhait Prive", "Souhait Importe Prive",
            "Livre Prive", "Mamie Jeanne", "c0ffee01", "serveur-secret",
        )) assertFalse("« $secret » ne doit pas partir :\n$text", text.contains(secret))
    }

    @Test
    fun theGeneratedTimeIsUtcSoTheTextDoesNotDependOnTheCaller() {
        assertTrue(text.contains("generated: 2026-"))
        assertTrue(text.lines().first { it.startsWith("generated:") }.endsWith("Z"))
    }

    @Test
    fun aSilentWatchIsSaidAsSuch() {
        val silent = Diagnostic.build(secretive.copy(lastCheck = now - 9 * hour), env, now)
        assertTrue(silent, silent.contains("silent: yes"))
        assertTrue(Diagnostic.build(secretive.copy(lastCheck = now - hour), env, now).contains("silent: no"))
    }
}
