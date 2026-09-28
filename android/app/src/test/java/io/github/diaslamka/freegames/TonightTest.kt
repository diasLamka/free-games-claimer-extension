package io.github.diaslamka.freegames

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.BackupIO
import io.github.diaslamka.freegames.data.Tonight
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Mark
import io.github.diaslamka.freegames.model.OwnedGame
import io.github.diaslamka.freegames.model.TitleMatch
import io.github.diaslamka.freegames.model.TonightPick
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.HttpResult
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import io.github.diaslamka.freegames.sources.text
import io.github.diaslamka.freegames.widget.TonightWidget
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.net.URLDecoder

/** « Ce soir je joue a... » (1.8.0) : les memes cas que test/tonight.test.mjs, et le widget. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "fr-rFR")
class TonightTest {
    private val now = 1_790_540_000_000L
    private val fixture = File(System.getProperty("fixtures"), "steam-getitems-tonight.json").readText()
    private val items = parseJson(fixture)["response"]["store_items"].arr!!
    private fun item(appid: String) = items.first { it["appid"].text == appid }
    private fun info(appid: String) = Tonight.readItem(item(appid), now)!!

    private val state = AppState(
        owned = mapOf(
            "steam:1145360" to OwnedGame("steam", "1145360", "Hades", "verified"),
            "steam:292030" to OwnedGame("steam", "292030", "The Witcher 3: Wild Hunt"),
            "steam:400" to OwnedGame("steam", "400", "Portal"),
            "steam:105600" to OwnedGame("steam", "105600", "Terraria"),
            "gog:1" to OwnedGame("gog", "1", "Celeste"),
        ),
        library = mapOf(
            "epic:balatro" to LibraryEntry("epic", "balatro", "Balatro", "https://store.epicgames.com/p/balatro", null, null, now - 200 * 86_400_000L),
            "epic:rate" to LibraryEntry("epic", "rate", "Rate", null, null, null, 1, status = "failed"),
        ),
    )
    private val apps = listOf("1145360", "292030", "400", "2379780", "105600").associateWith { info(it) }

    @Test
    fun theFormatComesFromSteamPlayersTagsOnTwelveRealGames() {
        val formats = items.associate { it["name"].str to Tonight.readItem(it, now)!!.format }
        assertEquals(Tonight.SESSIONS, formats["Hades"])
        assertEquals(Tonight.LONG, formats["The Witcher 3: Wild Hunt - Complete Edition"])
        assertEquals(Tonight.SHORT, formats["Portal"])
        assertEquals(Tonight.LONG, formats["Stardew Valley"])
        assertEquals(Tonight.LONG, formats["Outer Wilds"])
        assertNull(formats["Celeste"])
        assertEquals(Tonight.SESSIONS, formats["Balatro"])
        assertEquals(Tonight.LONG, formats["Cyberpunk 2077"])
        assertEquals(Tonight.SESSIONS, formats["Slay the Spire"])
        assertEquals(Tonight.SHORT, formats["What Remains of Edith Finch"])
        assertNull(formats["INSIDE"])
        assertEquals(Tonight.LONG, formats["Terraria"])
        val h = info("1145360")
        assertEquals(97, h.percent)
        assertEquals("verified", h.deck)
        assertTrue(h.image!!.startsWith("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145360/"))
        assertTrue(h.description!!.startsWith("Défiez le dieu des morts"))
        assertEquals(Tonight.INFO_VERSION, h.v)
        assertNull(info("400").description)
        assertEquals("Un jeu \"culte\" & court", Tonight.cleanDescription("Un <b>jeu</b> &quot;culte&quot;  &amp; court"))
        assertTrue(Tonight.cleanDescription("mot ".repeat(200))!!.endsWith("mot…"))
        assertEquals("french", Tonight.steamLanguage(java.util.Locale.FRANCE))
        assertEquals("english", Tonight.steamLanguage(java.util.Locale("pt")))
        assertNull(Tonight.readItem(parseJson("""{"success":2}"""), now))
    }

    @Test
    fun thePileLeavesOutWhatWasStartedOrSetAside() {
        val pile = Tonight.buildPile(state)
        assertEquals(listOf("Balatro", "Celeste", "Hades", "Portal", "Terraria", "The Witcher 3: Wild Hunt"), pile.map { it.title }.sorted())
        assertEquals("steam:1145360", pile.first { it.title == "Hades" }.key)
        assertEquals("verified", pile.first { it.title == "Hades" }.deck)
        assertTrue(pile.first { it.title == "Balatro" }.claimed)
        val marques = state.copy(marks = mapOf("steam:105600" to Mark("notForMe"), "steam:400" to Mark("playing"), "gog:1" to Mark("toTry")))
        val p2 = Tonight.buildPile(marques)
        assertFalse(p2.any { it.title == "Terraria" || it.title == "Portal" })
        assertTrue(p2.first { it.title == "Celeste" }.toTry)
        val cherche = state.copy(tonightTitles = mapOf("balatro" to TitleMatch(now, "2379780")))
        assertEquals("2379780", Tonight.buildPile(cherche).first { it.title == "Balatro" }.appid)
    }

    @Test
    fun theTimeYouHaveDecidesAndTheDrawVaries() {
        val c = Tonight.Candidate("k", "X", emptyMap(), null, false, false, false, null, null)
        assertNull(Tonight.score(c, apps["292030"], Tonight.HOUR, false))
        fun soir(a: String) = Tonight.score(c, apps[a], Tonight.EVENING, false)!!.score
        assertTrue(soir("400") > soir("1145360"))
        assertTrue(soir("1145360") > soir("292030"))
        fun we(a: String) = Tonight.score(c, apps[a], Tonight.WEEKEND, false)!!.score
        assertTrue(we("292030") > we("1145360"))
        assertNull(Tonight.score(c, null, Tonight.ANY, true))
        val r = Tonight.score(c.copy(toTry = true, claimed = true, since = now), apps["400"], Tonight.EVENING, true)!!
        // « Recupere gratuitement en... » n'est plus une raison (1.10.0) : la description le remplace.
        assertEquals(listOf("tonight_to_try", "tonight_short", "tonight_rating", "tonight_deck_verified"), r.reasons.map { it.key })

        val pile = Tonight.buildPile(state.copy(tonightTitles = mapOf("balatro" to TitleMatch(now, "2379780"))))
        val premier = Tonight.pick(pile, apps, Tonight.EVENING, false) { 0.0 }
        assertEquals("Portal", premier.pick!!.c.title)
        val vus = (0 until 20).map { i -> Tonight.pick(pile, apps, Tonight.EVENING, false) { i / 20.0 }.pick!!.c.title }.toSet()
        assertTrue(vus.toString(), vus.size >= 3)
        val tout = Tonight.pick(pile, apps, Tonight.EVENING, false, pile.map { it.key }) { 0.0 }
        assertTrue(tout.wrapped)
        assertNotEquals("Portal", Tonight.pick(pile, apps, Tonight.EVENING, false, listOf(premier.pick!!.c.key)) { 0.0 }.pick!!.c.title)
    }

    @Test
    fun everyGameGetsAnImage() {
        val lib = state.library + ("amazon:bm" to LibraryEntry("amazon", "bm", "Botany Manor", null, null, "https://m.media-amazon.com/images/bm.jpg", now))
        val bm = Tonight.buildPile(state.copy(library = lib)).first { it.title == "Botany Manor" }
        assertEquals("https://m.media-amazon.com/images/bm.jpg", Tonight.image(bm, null))
        assertEquals(Tonight.steamHeader("1425350"), Tonight.image(bm.copy(appid = "1425350"), null))
        assertEquals(info("1145360").image, Tonight.image(bm, info("1145360")))
        assertNull(Tonight.steamHeader("abc"))
    }

    @Test
    fun theChoiceHoldsTheEveningAndAnotherMovesOn() {
        val s = state.copy(tonightApps = apps)
        val (jeu, p) = Tonight.current(s, now) { 0.0 }
        assertEquals("Portal", jeu!!.c.title)
        val gardee = s.copy(tonight = p)
        assertEquals("Portal", Tonight.current(gardee, now + 3_600_000L) { 0.9 }.first!!.c.title)
        // Le lendemain, un nouveau tirage : le choix est date de nouveau.
        assertEquals(now + Tonight.PICK_KEEP_MS, Tonight.current(gardee, now + Tonight.PICK_KEEP_MS) { 0.0 }.second.at)
        val autre = Tonight.reroll(gardee, now) { 0.0 }
        assertNotEquals("steam:400", autre.tonight.key)
        assertEquals(listOf("steam:400"), autre.tonight.shown)
        val joue = Tonight.mark(autre, "steam:1145360", Tonight.PLAYING)
        assertEquals("playing", joue.marks.getValue("steam:1145360").status)
        assertEquals("https://store.steampowered.com/app/1145360/", Tonight.page(Tonight.buildPile(state).first { it.title == "Hades" }))
        assertEquals("https://store.epicgames.com/p/balatro", Tonight.page(Tonight.buildPile(state).first { it.title == "Balatro" }))
        val enJeu = s.copy(tonight = TonightPick(playing = "steam:1", playingTitle = "Hades", playingAt = now))
        assertTrue(Tonight.playing(enJeu.tonight, now + 3_600_000L))
        assertFalse(Tonight.playing(enJeu.tonight, now + Tonight.PICK_KEEP_MS))
        assertNull(Tonight.reroll(enJeu, now).tonight.playing)
    }

    @Test
    fun theSteamPassIsCookielessExactAndPaced() = runBlocking {
        val appels = mutableListOf<Pair<String, Boolean>>()
        val fetcher = object : Fetcher {
            override suspend fun get(url: String, withCookies: Boolean, accept: String): HttpResult {
                appels += url to withCookies
                if ("storesearch" in url) {
                    val term = URLDecoder.decode(url.substringAfter("term=").substringBefore('&'), "UTF-8")
                    val body = if (term == "Balatro") """{"items":[{"type":"app","id":2379780,"name":"Balatro"}]}""" else """{"items":[{"type":"app","id":5,"name":"$term Deluxe"}]}"""
                    return HttpResult(200, body)
                }
                val input = parseJson(URLDecoder.decode(url.substringAfter("input_json="), "UTF-8"))
                val ids = input["ids"].arr!!.map { it["appid"].text!! }
                val lus = items.filter { it["appid"].text in ids }.joinToString(",")
                return HttpResult(200, """{"response":{"store_items":[$lus]}}""")
            }
        }
        val (a, t) = Tonight.refresh(fetcher, state, now, "FR")
        assertTrue(appels.none { it.second })
        assertEquals(2, appels.count { "storesearch" in it.first })
        assertEquals("2379780", t.getValue("balatro").appid)
        assertNull(t.getValue("celeste").appid)
        assertEquals(Tonight.SESSIONS, a.getValue("1145360").format)
        assertEquals(97, a.getValue("2379780").percent)
        assertTrue(a.getValue("1145360").description!!.contains("dieu des morts"))
        appels.clear()
        val s2 = state.copy(tonightApps = a, tonightTitles = t)
        Tonight.refresh(fetcher, s2, now + 3_600_000L, "FR")
        assertTrue(appels.isEmpty())
        // Une fiche d'une forme ancienne (sans description) est relue tout de suite.
        val ancienne = s2.copy(tonightApps = a + ("1145360" to a.getValue("1145360").copy(v = 0, description = null)))
        val (a3, _) = Tonight.refresh(fetcher, ancienne, now + 3_600_000L, "FR")
        assertEquals(1, appels.count { "GetItems" in it.first })
        assertTrue(a3.getValue("1145360").description!!.contains("dieu des morts"))
        assertTrue(Tonight.due(state, now))
        assertFalse(Tonight.due(state.copy(tonightAt = now), now + 60_000))
        assertFalse(Tonight.due(state.copy(settings = state.settings.copy(tonight = false)), now))
    }

    @Test
    fun theExtensionBackupBringsTheCollectionAndTheMarksBack() {
        val backup = """{"exportFormat":2,"backup":{
            "veille:collection":{"stores":{},"items":{
              "steam:400":{"store":"steam","id":"400","title":"Portal","kind":"game","deck":"verified"},
              "steam:9":{"store":"steam","id":"9","title":"Une bande-son","kind":"other"},
              "gog:1":{"store":"gog","id":"1","title":"Celeste","kind":"game"}}},
            "veille:annotations":{"steam:400":{"status":"done","note":"fini en 2024"},"gog:1":{"status":"toTry","note":""},"epic:x":{"status":"nimporte"}}
        }}"""
        val avant = AppState(marks = mapOf("gog:1" to Mark("playing")))
        val (s, r) = BackupIO.import(avant, backup, now)!!
        assertEquals(setOf("steam:400", "gog:1"), s.owned.keys)
        assertEquals("verified", s.owned.getValue("steam:400").deck)
        assertEquals(2, r.owned)
        assertEquals("done", s.marks.getValue("steam:400").status)
        assertEquals("fini en 2024", s.marks.getValue("steam:400").note)
        assertEquals("playing", s.marks.getValue("gog:1").status)
        assertEquals(1, r.marks)
        val export = parseJson(BackupIO.export(s, now))["backup"]["veille:annotations"]
        assertEquals("done", export["steam:400"]["status"].str)
        assertNotNull(export["gog:1"])
        assertNull(parseJson(BackupIO.export(s, now))["backup"]["veille:collection"])
    }

    /* A la taille reelle d'un widget 4 x 2 sur un telephone : 350 x 190 dp, en xxhdpi. */
    @Test
    @Config(qualifiers = "fr-rFR-xxhdpi")
    fun theWidgetIsDrawnInTheCharter() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val s = state.copy(tonightApps = apps, tonight = TonightPick(time = Tonight.EVENING, key = "steam:400", at = now))
        val v = TonightWidget.views(app, s, now).apply(app, FrameLayout(app))
        assertEquals("Portal", v.findViewById<TextView>(R.id.widget_title).text.toString())
        assertEquals("Ce soir · Une soirée", v.findViewById<TextView>(R.id.widget_kicker).text.toString())
        assertTrue(v.findViewById<TextView>(R.id.widget_why).text.toString().contains("Court, d'après les joueurs Steam"))
        assertEquals(View.VISIBLE, v.findViewById<View>(R.id.widget_another).visibility)
        val dir = File(System.getProperty("screenshots") ?: "build/screenshots").apply { mkdirs() }
        dessine(v, 1050, 570, File(dir, "F-1-widget.png"))
        dessine(TonightWidget.views(app, s, now).apply(app, FrameLayout(app)), 690, 330, File(dir, "F-3-widget-petit.png"))
        val vide = TonightWidget.views(app, AppState(), now).apply(app, FrameLayout(app))
        assertEquals("Pile vide", vide.findViewById<TextView>(R.id.widget_title).text.toString())
        assertEquals(View.GONE, vide.findViewById<View>(R.id.widget_another).visibility)
        dessine(vide, 1050, 570, File(dir, "F-2-widget-vide.png"))
    }

    private fun dessine(v: View, w: Int, h: Int, f: File) {
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w + 40, h + 40, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(0xFF2E3B4E.toInt())
        c.translate(20f, 20f)
        v.draw(c)
        f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    /* « A plusieurs » (1.12.0) : la meme capture de dix jeux reels que test/tonight.test.mjs. */
    private val coopItems = parseJson(File(System.getProperty("fixtures"), "steam-getitems-coop.json").readText())["response"]["store_items"].arr!!
    private fun coopInfo(name: String) = Tonight.readItem(coopItems.first { it["name"].str!!.startsWith(name) }, now)!!

    @Test
    fun coopIsReadFromTheTagsAndNeverGuessed() {
        for (n in listOf("It Takes Two", "Overcooked", "Portal 2", "HELLDIVERS", "Stardew Valley", "Terraria", "Cuphead")) assertEquals(n, true, coopInfo(n).coop)
        for (n in listOf("Hades", "Balatro", "Hollow Knight")) assertEquals(n, false, coopInfo(n).coop)
        assertNull(Tonight.coopFromTags(emptyList()))
        assertEquals(false, Tonight.coopFromTags(listOf(19 to 900.0, 1685 to 40.0)))
        assertEquals(Tonight.INFO_VERSION, 4)
    }

    @Test
    fun withOthersOnlyKeepsGamesPlayedThatWay() {
        val c = Tonight.Candidate("k", "X", emptyMap(), null, false, false, false, null, null)
        assertNull(Tonight.score(c, coopInfo("Hades"), Tonight.ANY, false, coop = true))
        assertNull(Tonight.score(c, null, Tonight.ANY, false, coop = true))
        val r = Tonight.score(c, coopInfo("It Takes Two"), Tonight.ANY, false, coop = true)!!
        assertTrue(r.reasons.any { it.key == "tonight_coop" })
        assertTrue(Tonight.score(c, coopInfo("It Takes Two"), Tonight.ANY, false)!!.reasons.none { it.key == "tonight_coop" })
        val pile = listOf(
            c.copy(key = "a", title = "It Takes Two", appid = "1426210"),
            c.copy(key = "b", title = "Hades", appid = "1145360"),
            c.copy(key = "c", title = "Terraria", appid = "105600"),
        )
        val apps = coopItems.associate { it["appid"].text!! to Tonight.readItem(it, now)!! }
        val p = Tonight.pick(pile, apps, Tonight.ANY, false, random = { 0.0 }, coop = true)
        assertEquals(2, p.count)
        assertNotEquals("Hades", p.pick!!.c.title)
        assertEquals(3, Tonight.pick(pile, apps, Tonight.ANY, false, random = { 0.0 }).count)
    }

    @Test
    fun oldCardsAreReadAgainToTakeTheirCoopFlag() = runBlocking {
        val appels = mutableListOf<String>()
        val fetcher = object : Fetcher {
            override suspend fun get(url: String, withCookies: Boolean, accept: String): HttpResult {
                appels += url
                val ids = parseJson(URLDecoder.decode(url.substringAfter("input_json="), "UTF-8"))["ids"].arr!!.map { it["appid"].text!! }
                return HttpResult(200, """{"response":{"store_items":[${coopItems.filter { it["appid"].text in ids }.joinToString(",")}]}}""")
            }
        }
        val s = AppState(
            owned = mapOf("steam:1426210" to OwnedGame("steam", "1426210", "It Takes Two")),
            tonightApps = mapOf("1426210" to io.github.diaslamka.freegames.model.TonightInfo(at = now - 3_600_000L, v = 2, name = "It Takes Two")),
        )
        val (a, _) = Tonight.refresh(fetcher, s, now, "FR")
        assertEquals(1, appels.count { "GetItems" in it })
        assertEquals(true, a.getValue("1426210").coop)
        assertEquals(Tonight.INFO_VERSION, a.getValue("1426210").v)
    }
}
